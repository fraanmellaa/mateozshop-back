import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { DEFAULT_COUNTRY, HIDDEN_COUNTRIES } from "./countries";

export { DEFAULT_COUNTRY, HIDDEN_COUNTRIES };

export interface PublicBonus {
  id: number;
  casino_name: string;
  offer: string;
  description: string | null;
  image: string | null;
  url: string | null;
  color: string | null;
  button_text: string | null;
  featured: boolean;
  conditions: string | null;
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
  color?: string | null;
  button_text?: string | null;
  featured?: boolean;
  conditions?: string | null;
  countries?: string[];
  blocked_countries?: string[];
  position?: number;
  is_active?: boolean;
}

const PUBLIC_COLUMNS = "id, casino_name, offer, description, image, url, color, button_text, featured, conditions";
const ADMIN_COLUMNS = `${PUBLIC_COLUMNS}, countries, blocked_countries, position, is_active, created_at, updated_at`;

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Función única de visibilidad: activo, país del visitante en `countries`
 * (países con licencia; vacía = ninguno), no bloqueado y no oculto.
 * Sin país se trata como ES.
 */
export function isBonusVisible(
  bonus: Pick<Bonus, "is_active" | "countries" | "blocked_countries">,
  country: string | null
): boolean {
  if (!bonus.is_active) return false;
  const code = country ?? DEFAULT_COUNTRY;
  if (HIDDEN_COUNTRIES.includes(code)) return false;
  if (bonus.blocked_countries.includes(code)) return false;
  return bonus.countries.includes(code);
}

/** Bonos visibles para un país (null = desconocido -> ES), en el orden de la web. */
export async function getActiveBonuses(
  country: string | null
): Promise<PublicBonus[]> {
  if (HIDDEN_COUNTRIES.includes(country ?? DEFAULT_COUNTRY)) return [];

  const { data, error } = await getSupabaseAdmin()
    .from("bonuses")
    .select(`${PUBLIC_COLUMNS}, is_active, countries, blocked_countries`)
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as Bonus[])
    .filter((bonus) => isBonusVisible(bonus, country))
    .map(
      ({ id, casino_name, offer, description, image, url, color, button_text, featured, conditions }) => ({
        id,
        casino_name,
        offer,
        description,
        image,
        url,
        color,
        button_text,
        featured,
        conditions,
      })
    );
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
      color: input.color ?? null,
      button_text: input.button_text ?? null,
      featured: input.featured ?? false,
      conditions: input.conditions ?? null,
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
    "color",
    "button_text",
    "featured",
    "conditions",
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
