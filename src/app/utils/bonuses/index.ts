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
  /** Euros de primer depósito que pide este casino para verificarse. */
  verify_min_deposit: number;
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
  verify_min_deposit?: number;
  countries?: string[];
  blocked_countries?: string[];
  position?: number;
  is_active?: boolean;
}

const BASE_COLUMNS = "id, casino_name, offer, description, image, url, color, button_text, featured, conditions";
const ADMIN_EXTRA = "countries, blocked_countries, position, is_active, created_at, updated_at";

/** Depósito mínimo para verificarse cuando el casino no tiene otro puesto. */
export const DEFAULT_VERIFY_MIN_DEPOSIT = 30;

// La columna `verify_min_deposit` llega con la migración 0041. Hasta que se
// aplique, las consultas se repiten sin ella y se usan estos valores (los
// mismos que deja puestos la migración). Después solo manda la columna.
const MIN_DEPOSIT_BEFORE_MIGRATION: Record<string, number> = { "casino gran madrid": 50 };
let hasMinDepositColumn: boolean | null = null;

const publicColumns = (withMin: boolean) => (withMin ? `${BASE_COLUMNS}, verify_min_deposit` : BASE_COLUMNS);
const adminColumns = (withMin: boolean) => `${publicColumns(withMin)}, ${ADMIN_EXTRA}`;

const isMissingColumn = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "42703" || error.code === "PGRST204" || /verify_min_deposit/.test(error.message ?? ""));

/**
 * Ejecuta una consulta de bonos con la columna del depósito mínimo y, si la
 * columna aún no existe, la repite sin ella.
 */
async function withMinDeposit<T>(
  run: (withMin: boolean) => PromiseLike<{ data: T; error: { code?: string; message?: string } | null }>
) {
  if (hasMinDepositColumn !== false) {
    const first = await run(true);
    if (!isMissingColumn(first.error)) {
      if (!first.error) hasMinDepositColumn = true;
      return first;
    }
    hasMinDepositColumn = false;
    // Se vuelve a comprobar pasado un minuto, por si ya se aplicó la migración.
    setTimeout(() => {
      hasMinDepositColumn = null;
    }, 60_000).unref?.();
  }
  return run(false);
}

/** Rellena el depósito mínimo de una fila leída sin la columna. */
function fillMinDeposit<T extends { casino_name: string; verify_min_deposit?: number | null }>(row: T) {
  const fallback =
    MIN_DEPOSIT_BEFORE_MIGRATION[row.casino_name.trim().toLowerCase()] ?? DEFAULT_VERIFY_MIN_DEPOSIT;
  return { ...row, verify_min_deposit: Number(row.verify_min_deposit ?? fallback) };
}

/** Depósito mínimo de cada casino, por nombre en minúsculas (panel de Verificaciones). */
export async function getMinDepositByCasino(): Promise<Record<string, number>> {
  const { data, error } = await withMinDeposit((withMin) =>
    getSupabaseAdmin()
      .from("bonuses")
      .select(withMin ? "casino_name, verify_min_deposit" : "casino_name")
  );
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const row of (data ?? []) as unknown as Array<{ casino_name: string; verify_min_deposit?: number }>) {
    out[row.casino_name.trim().toLowerCase()] = fillMinDeposit(row).verify_min_deposit;
  }
  return out;
}

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

  const { data, error } = await withMinDeposit((withMin) =>
    getSupabaseAdmin()
      .from("bonuses")
      .select(`${publicColumns(withMin)}, is_active, countries, blocked_countries`)
      .eq("is_active", true)
      .order("position", { ascending: true })
      .order("id", { ascending: true })
  );

  if (error) throw error;
  return ((data ?? []) as unknown as Bonus[])
    .filter((bonus) => isBonusVisible(bonus, country))
    .map(fillMinDeposit)
    .map(
      ({ id, casino_name, offer, description, image, url, color, button_text, featured, conditions, verify_min_deposit }) => ({
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
        verify_min_deposit,
      })
    );
}

/** Todos los bonos (panel). */
export async function getAllBonuses(): Promise<Bonus[]> {
  const { data, error } = await withMinDeposit((withMin) =>
    getSupabaseAdmin()
      .from("bonuses")
      .select(adminColumns(withMin))
      .order("position", { ascending: true })
      .order("id", { ascending: true })
  );

  if (error) throw error;
  return ((data ?? []) as unknown as Bonus[]).map(fillMinDeposit);
}

export async function createBonus(input: BonusInput): Promise<Bonus> {
  const now = nowSeconds();
  const { data, error } = await withMinDeposit((withMin) =>
    getSupabaseAdmin()
    .from("bonuses")
    .insert({
      ...(withMin ? { verify_min_deposit: input.verify_min_deposit ?? DEFAULT_VERIFY_MIN_DEPOSIT } : {}),
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
    .select(adminColumns(withMin))
    .single()
  );

  if (error) throw error;
  return fillMinDeposit(data as unknown as Bonus);
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

  const { data, error } = await withMinDeposit((withMin) =>
    getSupabaseAdmin()
      .from("bonuses")
      .update(
        withMin && input.verify_min_deposit !== undefined
          ? { ...patch, verify_min_deposit: input.verify_min_deposit }
          : patch
      )
      .eq("id", id)
      .select(adminColumns(withMin))
      .maybeSingle()
  );

  if (error) throw error;
  return data ? fillMinDeposit(data as unknown as Bonus) : null;
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
