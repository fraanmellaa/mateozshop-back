import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isMissingColumn, isMissingVipSchema } from "@/app/utils/products/currency";

import { PointsError, type PointsErrorCode, type PointsMoveOptions } from "./index";

/**
 * Puntos VIP (migración 0032): segunda moneda, solo para usuarios verificados y
 * solo para pujar por premios en VIP. Igual que con los puntos normales, todo
 * cambio de saldo pasa por SQL (`vip_move`) y queda en `vip_transactions`: no
 * escribir nunca `users.vip_points` desde el código.
 *
 * Mientras la migración no esté aplicada, estas funciones lanzan
 * VipUnavailableError y el resto del back sigue funcionando.
 */

export class VipUnavailableError extends Error {
  constructor() {
    super("VIP_UNAVAILABLE");
    this.name = "VipUnavailableError";
  }
}

const VIP_CODES = new Set<string>(["INVALID_AMOUNT", "USER_NOT_FOUND", "USER_BANNED", "INSUFFICIENT_POINTS"]);

type RpcError = { code?: string; message?: string; details?: string | null };

function toError(error: RpcError): Error {
  if (isMissingVipSchema(error)) return new VipUnavailableError();
  const message = String(error.message || "").trim();
  if (VIP_CODES.has(message)) return new PointsError(message as PointsErrorCode, error.details ?? null);
  return new Error(`VIP RPC failed: ${message || "unknown error"}`);
}

async function vipRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseAdmin().rpc(fn, args);
  if (error) throw toError(error);
  return data as T;
}

function moveArgs(userId: number, amount: number, op: string, o: PointsMoveOptions) {
  return {
    p_user_id: userId,
    p_amount: amount,
    p_op: op,
    p_kind: o.kind,
    p_ref_type: o.refType ?? null,
    p_ref_id: o.refId === undefined ? null : String(o.refId),
    p_idempotency_key: o.idempotencyKey ?? null,
    p_meta: o.meta ?? null,
  };
}

/** Suma puntos VIP. Devuelve el saldo VIP. */
export function creditVip(userId: number, amount: number, o: PointsMoveOptions) {
  return vipRpc<number>("vip_move", moveArgs(userId, amount, "credit", o));
}

/** Repone puntos VIP descontados por una puja o un pedido. Devuelve el saldo VIP. */
export function refundVip(userId: number, amount: number, o: PointsMoveOptions) {
  return vipRpc<number>("vip_move", moveArgs(userId, amount, "refund", o));
}

/** Quita puntos VIP (admin). Lanza INSUFFICIENT_POINTS. Devuelve el saldo VIP. */
export function revokeVip(userId: number, amount: number, o: PointsMoveOptions) {
  return vipRpc<number>("vip_move", moveArgs(userId, amount, "revoke", o));
}

/** Reparto por minuto a los verificados activos en el chat (idempotente por minuto). */
export function vipWatchTick(
  rates: { one: number; two: number; three: number },
  chatWindowSeconds: number
) {
  // Tramo según en cuántos casinos está verificado: 1, 2, o 3 o más.
  return vipRpc<{ ok: boolean; reason?: string; minute?: number; paid?: number; points?: number }>(
    "vip_watch_tick",
    {
      p_rate_one: rates.one,
      p_rate_two: rates.two,
      p_rate_three: rates.three,
      p_chat_window_seconds: chatWindowSeconds,
    }
  );
}

/** Una tanda del reinicio mensual de saldos VIP. */
export function vipResetBalances(month: string, limit: number) {
  return vipRpc<{ processed: number; remaining: number }>("vip_reset_balances", {
    p_month: month,
    p_limit: limit,
  });
}

/**
 * Marca o desmarca a mano a un usuario como verificado. Desmarcar retira todas
 * sus verificaciones de casino. Devuelve false si no existe.
 */
export function setUserVerified(userId: number, verified: boolean, admin: string): Promise<boolean> {
  return vipRpc<boolean>("verification_set_user", {
    p_user_id: userId,
    p_verified: verified,
    p_admin: admin,
  });
}

/** Moneda en la que se pagó un pedido (`points` si falta la migración 0032). */
export async function getOrderCurrency(orderId: number): Promise<"points" | "vip"> {
  const { data, error } = await getSupabaseAdmin()
    .from("orders")
    .select("currency")
    .eq("id", orderId)
    .limit(1);
  if (error) {
    if (isMissingColumn(error, "currency")) return "points";
    throw error;
  }
  return data?.[0]?.currency === "vip" ? "vip" : "points";
}
