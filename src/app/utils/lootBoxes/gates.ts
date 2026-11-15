import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAccountOldEnough } from "@/app/utils/accounts/age";
import { assertAdult } from "@/app/utils/accounts/adult";
import { PointsError } from "@/app/utils/points";

/**
 * Requisitos para gastar puntos en cajas y tickets de sorteo. Deben coincidir
 * con lo que comprueban `open_loot_box` y `buy_giveaway_ticket` (0024): aquí
 * se comprueban ANTES de reservar un nonce o llamar a la función SQL, para no
 * gastar nonces en peticiones inválidas; el SQL sigue siendo la barrera final.
 */

export type GateCode = "USER_ACCOUNT_NOT_LINKED" | "ACCOUNT_TOO_NEW" | "ADULT_REQUIRED";

const GATE_STATUS: Record<GateCode, number> = {
  USER_ACCOUNT_NOT_LINKED: 409,
  ACCOUNT_TOO_NEW: 403,
  ADULT_REQUIRED: 403,
};

export const isGateCode = (code: string): code is GateCode => code in GATE_STATUS;

export class GateError extends Error {
  code: GateCode;
  status: number;
  extra: Record<string, unknown>;

  constructor(code: GateCode, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = "GateError";
    this.code = code;
    this.status = GATE_STATUS[code];
    this.extra = extra;
  }
}

export function gateErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof GateError)) return null;
  return NextResponse.json({ success: false, error: error.code, ...error.extra }, { status: error.status });
}

const DEFAULT_MIN_AGE_DAYS = 30;

/** `shop.minAccountAgeDays` de app_settings (por defecto 30). */
export async function getMinAccountAgeDays(): Promise<number> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("app_settings")
      .select("value")
      .eq("key", "shop")
      .maybeSingle();
    if (error) throw error;
    const raw = (data?.value as { minAccountAgeDays?: unknown } | null)?.minAccountAgeDays;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Math.min(Math.max(Math.floor(raw), 0), 3650);
    }
  } catch (error) {
    console.error("[gates] could not read shop settings, using default:", error);
  }
  return DEFAULT_MIN_AGE_DAYS;
}

type GateUser = {
  kick_id: string | null;
  twitch_id: string | null;
  adult_confirmed_at: number | null;
  twitch_created_at: number | null;
  kick_linked_at: number | null;
  is_banned: boolean | null;
  total_points: number | null;
  used_points: number | null;
};

const GATE_COLUMNS =
  "kick_id, twitch_id, adult_confirmed_at, twitch_created_at, kick_linked_at, is_banned, total_points, used_points";

/**
 * Comprueba usuario existente, no baneado, cuenta vinculada, +18 y antigüedad.
 * Devuelve el saldo disponible. Lanza PointsError / GateError / AccountError.
 */
export async function assertCanSpend(userId: number): Promise<{ balance: number }> {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select(GATE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new PointsError("USER_NOT_FOUND");

  const user = data as GateUser;
  if (user.is_banned) throw new PointsError("USER_BANNED");
  if (!user.kick_id && !user.twitch_id) throw new GateError("USER_ACCOUNT_NOT_LINKED");
  assertAdult(user);

  const minDays = await getMinAccountAgeDays();
  if (!isAccountOldEnough(user, minDays)) throw new GateError("ACCOUNT_TOO_NEW", { minDays });

  return { balance: Number(user.total_points ?? 0) - Number(user.used_points ?? 0) };
}
