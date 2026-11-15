import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { GateError, isGateCode } from "@/app/utils/lootBoxes/gates";
import { PointsError, type PointsErrorCode } from "@/app/utils/points";

const KNOWN = new Set<string>([
  "USER_NOT_FOUND",
  "USER_BANNED",
  "INSUFFICIENT_POINTS",
  "USER_KICK_ID_NOT_FOUND",
  "GIVEAWAY_NOT_FOUND",
  "GIVEAWAY_NOT_STARTED",
  "GIVEAWAY_CLOSED",
]);

/**
 * Compra un ticket (buy_giveaway_ticket, 0024): además del cobro exige cuenta
 * vinculada (Kick o Twitch), +18 y antigüedad de cuenta. Traduce los errores
 * de negocio a PointsError / GateError.
 */
export async function buyGiveawayTicket(userId: number, giveawayId: number) {
  const { data, error } = await getSupabaseAdmin().rpc("buy_giveaway_ticket", {
    p_user_id: userId,
    p_giveaway_id: giveawayId,
  });
  if (error) {
    const code = String(error.message || "").trim();
    if (isGateCode(code)) {
      throw new GateError(code, code === "ACCOUNT_TOO_NEW" && error.details ? { minDays: Number(error.details) } : {});
    }
    if (KNOWN.has(code)) throw new PointsError(code as PointsErrorCode, error.details ?? null);
    throw new Error(`buy_giveaway_ticket failed: ${code || "unknown error"}`);
  }
  return data as { entry_id: number; giveaway_id: number; user_id: number; balance: number };
}
