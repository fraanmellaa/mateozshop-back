import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { GateError, isGateCode } from "@/app/utils/lootBoxes/gates";
import { PointsError, type PointsErrorCode } from "@/app/utils/points";
import { isMissingFunction } from "@/app/utils/products/currency";

const KNOWN = new Set<string>([
  "USER_NOT_FOUND",
  "USER_BANNED",
  "INSUFFICIENT_POINTS",
  "USER_KICK_ID_NOT_FOUND",
  "GIVEAWAY_NOT_FOUND",
  "GIVEAWAY_NOT_STARTED",
  "GIVEAWAY_CLOSED",
  "INVALID_QUANTITY",
]);

/**
 * Compra un ticket (buy_giveaway_ticket, 0024): además del cobro exige cuenta
 * vinculada (Kick o Twitch), +18 y antigüedad de cuenta. Traduce los errores
 * de negocio a PointsError / GateError.
 */
function toError(error: { message?: string; details?: string | null }): Error {
  const code = String(error.message || "").trim();
  if (isGateCode(code)) {
    return new GateError(code, code === "ACCOUNT_TOO_NEW" && error.details ? { minDays: Number(error.details) } : {});
  }
  if (KNOWN.has(code)) return new PointsError(code as PointsErrorCode, error.details ?? null);
  return new Error(`buy_giveaway_ticket failed: ${code || "unknown error"}`);
}

export async function buyGiveawayTicket(userId: number, giveawayId: number) {
  const { data, error } = await getSupabaseAdmin().rpc("buy_giveaway_ticket", {
    p_user_id: userId,
    p_giveaway_id: giveawayId,
  });
  if (error) throw toError(error);
  return data as { entry_id: number; giveaway_id: number; user_id: number; balance: number };
}

/** Máximo de tickets en una sola compra. */
export const MAX_TICKETS_PER_PURCHASE = 100;

export type BoughtTickets = { tickets: number; entry_id: number; balance: number };

/**
 * Compra varios tickets del mismo sorteo. Con la migración 0034 va en una sola
 * transacción (todos o ninguno). Sin ella se compran de uno en uno: si a mitad
 * algo falla, se queda con los ya comprados y se lanza el error solo si no se
 * ha podido comprar ninguno.
 */
export async function buyGiveawayTickets(userId: number, giveawayId: number, quantity: number): Promise<BoughtTickets> {
  if (quantity === 1) {
    const one = await buyGiveawayTicket(userId, giveawayId);
    return { tickets: 1, entry_id: one.entry_id, balance: one.balance };
  }

  const { data, error } = await getSupabaseAdmin().rpc("buy_giveaway_tickets", {
    p_user_id: userId,
    p_giveaway_id: giveawayId,
    p_quantity: quantity,
  });
  if (!error) return data as BoughtTickets;
  if (!isMissingFunction(error, "buy_giveaway_tickets")) throw toError(error);

  let last: { entry_id: number; balance: number } | null = null;
  let bought = 0;
  for (; bought < quantity; bought++) {
    try {
      last = await buyGiveawayTicket(userId, giveawayId);
    } catch (failure) {
      if (!last) throw failure;
      break;
    }
  }
  return { tickets: bought, entry_id: last!.entry_id, balance: last!.balance };
}
