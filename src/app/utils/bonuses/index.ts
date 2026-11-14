import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface PublicBonus {
  id: number;
  casino_name: string;
  offer: string;
  description: string | null;
  image: string | null;
  url: string | null;
}

export interface Bonus extends PublicBonus {
  countries: string[];
  blocked_countries: string[];
  position: number;
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface BonusInput {
  casino_name: string;
  offer: string;
  description?: string | null;
  image?: string | null;
  url?: string | null;
  countries?: string[];
  blocked_countries?: string[];
  position?: number;
  is_active?: boolean;
}

const PUBLIC_COLUMNS = "id, casino_name, offer, description, image, url";
const ADMIN_COLUMNS = `${PUBLIC_COLUMNS}, countries, blocked_countries, position, is_active, created_at, updated_at`;

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Regla de visibilidad: activo, país no bloqueado y (lista blanca vacía o que
 * lo contenga). Con país desconocido (null) solo valen los de lista blanca vacía.
 */
export function isBonusVisible(
  bonus: Pick<Bonus, "is_active" | "countries" | "blocked_countries">,
  country: string | null
): boolean {
  if (!bonus.is_active) return false;
  if (country && bonus.blocked_countries.includes(country)) return false;
  if (bonus.countries.length === 0) return true;
  return country !== null && bonus.countries.includes(country);
}

/** Bonos visibles para un país (null = desconocido), en el orden de la web. */
export async function getActiveBonuses(
  country: string | null
): Promise<PublicBonus[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("bonuses")
    .select(`${PUBLIC_COLUMNS}, is_active, countries, blocked_countries`)
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as Bonus[])
    .filter((bonus) => isBonusVisible(bonus, country))
    .map(({ id, casino_name, offer, description, image, url }) => ({
      id,
      casino_name,
      offer,
      description,
      image,
      url,
    }));
}

/** Todos los bonos (panel). */
export async function getAllBonuses(): Promise<Bonus[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("bonuses")
    .select(ADMIN_COLUMNS)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Bonus[];
}

export async function createBonus(input: BonusInput): Promise<Bonus> {
  const now = nowSeconds();
  const { data, error } = await getSupabaseAdmin()
    .from("bonuses")
    .insert({
      casino_name: input.casino_name,
      offer: input.offer,
      description: input.description ?? null,
      image: input.image ?? null,
      url: input.url ?? null,
      countries: input.countries ?? [],
      blocked_countries: input.blocked_countries ?? [],
      position: input.position ?? 0,
      is_active: input.is_active ?? true,
      created_at: now,
      updated_at: now,
    })
    .select(ADMIN_COLUMNS)
    .single();

  if (error) throw error;
  return data as Bonus;
}

/** Actualización parcial. Devuelve null si el bono no existe. */
export async function updateBonus(
  id: number,
  input: Partial<BonusInput>
): Promise<Bonus | null> {
  const patch: Record<string, unknown> = { updated_at: nowSeconds() };
  for (const key of [
    "casino_name",
    "offer",
    "description",
    "image",
    "url",
    "countries",
    "blocked_countries",
    "position",
    "is_active",
  ] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }

  const { data, error } = await getSupabaseAdmin()
    .from("bonuses")
    .update(patch)
    .eq("id", id)
    .select(ADMIN_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return (data as Bonus | null) ?? null;
}

/** Devuelve false si el bono no existía. */
export async function deleteBonus(id: number): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("bonuses")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}
