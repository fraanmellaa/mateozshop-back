import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getEconomySettings } from "@/app/utils/economy/settings";

/**
 * Premio mensual del ranking de TikTok: puntos para el top 3 del mes. Los
 * ganadores los elige el administrador a mano en el panel (no se calculan por
 * visitas). El abono y los topes (un premio por puesto y mes, una persona no
 * ocupa dos puestos) van en SQL: tiktok_grant_month_prize (migración 0037).
 */

export type TikTokMonthWinner = {
  place: number;
  user_id: number;
  username: string | null;
  points: number;
  created_at: number;
};

export type TikTokMonthPrizes = {
  month: string;
  /** Puntos del 1.º, 2.º y 3.º según los ajustes de economía. */
  prizes: [number, number, number];
  winners: TikTokMonthWinner[];
  /** false si falta aplicar la migración 0037. */
  available: boolean;
};

export class TikTokPrizeError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "TikTokPrizeError";
    this.code = code;
  }
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isValidMonth = (value: unknown): value is string =>
  typeof value === "string" && MONTH_RE.test(value);

/** La tabla o la función aún no existen (migración sin aplicar). */
function isMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST202" ||
    /does not exist|could not find/i.test(error.message ?? "")
  );
}

export async function getTikTokMonthPrizes(month: string): Promise<TikTokMonthPrizes> {
  const settings = await getEconomySettings();
  const prizes = settings.tiktok.monthlyPrizes;

  const { data, error } = await getSupabaseAdmin()
    .from("tiktok_month_prizes")
    .select("place, user_id, points, created_at, users(username)")
    .eq("month", month)
    .order("place", { ascending: true });
  if (error) {
    if (isMissing(error)) return { month, prizes, winners: [], available: false };
    throw error;
  }

  const winners = (data ?? []).map((row) => {
    const user = Array.isArray(row.users) ? row.users[0] : row.users;
    return {
      place: Number(row.place),
      user_id: Number(row.user_id),
      username: (user as { username?: string | null } | null)?.username ?? null,
      points: Number(row.points),
      created_at: Number(row.created_at),
    };
  });
  return { month, prizes, winners, available: true };
}

/** Busca al ganador por id de la tienda, id de Discord o nombre de usuario exacto. */
async function resolveUser(reference: string): Promise<number> {
  const ref = reference.trim();
  if (!ref) throw new TikTokPrizeError("USER_NOT_FOUND");
  const supabase = getSupabaseAdmin();

  if (/^\d{1,9}$/.test(ref)) {
    const byId = await supabase.from("users").select("id").eq("id", Number(ref)).limit(1);
    if (byId.error) throw byId.error;
    if (byId.data?.[0]) return Number(byId.data[0].id);
  }
  if (/^\d{10,25}$/.test(ref)) {
    const byDiscord = await supabase.from("users").select("id").eq("discord_id", ref).limit(1);
    if (byDiscord.error) throw byDiscord.error;
    if (byDiscord.data?.[0]) return Number(byDiscord.data[0].id);
  }

  // Nombre exacto, sin distinguir mayúsculas (los comodines de ilike se escapan).
  const pattern = ref.replace(/[\\%_]/g, (char) => `\\${char}`);
  const byName = await supabase.from("users").select("id").ilike("username", pattern).limit(2);
  if (byName.error) throw byName.error;
  if ((byName.data?.length ?? 0) > 1) throw new TikTokPrizeError("USER_AMBIGUOUS");
  if (byName.data?.[0]) return Number(byName.data[0].id);
  throw new TikTokPrizeError("USER_NOT_FOUND");
}

const SQL_ERRORS = new Set([
  "INVALID_MONTH",
  "INVALID_PLACE",
  "INVALID_AMOUNT",
  "USER_NOT_FOUND",
  "USER_BANNED",
  "PLACE_TAKEN",
  "ALREADY_WINNER",
]);

/** Entrega el premio de un puesto del mes al usuario indicado. */
export async function grantTikTokMonthPrize(input: {
  month: string;
  place: number;
  user: string;
  admin: string;
}): Promise<TikTokMonthPrizes> {
  if (!isValidMonth(input.month)) throw new TikTokPrizeError("INVALID_MONTH");
  if (![1, 2, 3].includes(input.place)) throw new TikTokPrizeError("INVALID_PLACE");

  const settings = await getEconomySettings();
  const points = settings.tiktok.monthlyPrizes[input.place - 1];
  if (!points || points < 1) throw new TikTokPrizeError("INVALID_AMOUNT");

  const userId = await resolveUser(input.user);
  const { error } = await getSupabaseAdmin().rpc("tiktok_grant_month_prize", {
    p_month: input.month,
    p_place: input.place,
    p_user_id: userId,
    p_points: points,
    p_admin: input.admin,
  });
  if (error) {
    const message = String(error.message || "").trim();
    if (SQL_ERRORS.has(message)) throw new TikTokPrizeError(message);
    if (isMissing(error)) throw new TikTokPrizeError("MIGRATION_PENDING");
    throw error;
  }
  return getTikTokMonthPrizes(input.month);
}
