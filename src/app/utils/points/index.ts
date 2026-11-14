import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Operaciones de puntos. TODO cambio de saldo pasa por las funciones SQL de
 * migrations/0012_points_ledger_games.sql: son atómicas y dejan registro en
 * `point_transactions`. No escribir nunca `total_points` / `used_points`
 * directamente desde el código.
 */

export type PointsErrorCode =
  | "INVALID_AMOUNT"
  | "USER_NOT_FOUND"
  | "USER_BANNED"
  | "INSUFFICIENT_POINTS"
  | "PRODUCT_NOT_FOUND"
  | "AUCTION_PRODUCT_USE_BID"
  | "OUT_OF_STOCK"
  | "NO_CODES_AVAILABLE"
  | "USER_KICK_ID_NOT_FOUND"
  | "GIVEAWAY_NOT_FOUND"
  | "GIVEAWAY_NOT_STARTED"
  | "GIVEAWAY_CLOSED"
  | "PRODUCT_NOT_AUCTION"
  | "AUCTION_NOT_ACTIVE"
  | "AUCTION_MISSING_END_DATE"
  | "AUCTION_ENDED"
  | "BID_TOO_LOW"
  | "INVALID_WATCH_CONFIG"
  | "BOX_NOT_FOUND"
  | "BOX_NOT_ACTIVE"
  | "PRIZE_UNAVAILABLE"
  | "PRIZE_OUT_OF_STOCK"
  | "NO_PRIZES_AVAILABLE";

const KNOWN_CODES = new Set<string>([
  "INVALID_AMOUNT",
  "USER_NOT_FOUND",
  "USER_BANNED",
  "INSUFFICIENT_POINTS",
  "PRODUCT_NOT_FOUND",
  "AUCTION_PRODUCT_USE_BID",
  "OUT_OF_STOCK",
  "NO_CODES_AVAILABLE",
  "USER_KICK_ID_NOT_FOUND",
  "GIVEAWAY_NOT_FOUND",
  "GIVEAWAY_NOT_STARTED",
  "GIVEAWAY_CLOSED",
  "PRODUCT_NOT_AUCTION",
  "AUCTION_NOT_ACTIVE",
  "AUCTION_MISSING_END_DATE",
  "AUCTION_ENDED",
  "BID_TOO_LOW",
  "INVALID_WATCH_CONFIG",
  "BOX_NOT_FOUND",
  "BOX_NOT_ACTIVE",
  "PRIZE_UNAVAILABLE",
  "PRIZE_OUT_OF_STOCK",
]);

/** Error de negocio lanzado por una función SQL (RAISE EXCEPTION 'CODIGO'). */
export class PointsError extends Error {
  code: PointsErrorCode;
  detail: string | null;

  constructor(code: PointsErrorCode, detail: string | null = null) {
    super(code);
    this.name = "PointsError";
    this.code = code;
    this.detail = detail;
  }
}

export function isPointsError(error: unknown): error is PointsError {
  return error instanceof PointsError;
}

type RpcError = { message?: string; details?: string | null };

function toError(error: RpcError): Error {
  const message = String(error.message || "").trim();
  if (KNOWN_CODES.has(message)) {
    return new PointsError(message as PointsErrorCode, error.details ?? null);
  }
  return new Error(`Points RPC failed: ${message || "unknown error"}`);
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseAdmin().rpc(fn, args);
  if (error) throw toError(error);
  return data as T;
}

export type PointsMoveOptions = {
  /** Motivo, p. ej. "mines_bet", "admin_add". Queda en el libro de movimientos. */
  kind: string;
  refType?: string;
  refId?: string | number;
  /** Si ya existe un movimiento con esta clave, no se aplica de nuevo. */
  idempotencyKey?: string;
  meta?: Record<string, unknown>;
};

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

/** Suma puntos ganados. Devuelve el saldo disponible. */
export function creditPoints(userId: number, amount: number, o: PointsMoveOptions) {
  return rpc<number>("points_move", moveArgs(userId, amount, "credit", o));
}

/** Gasta puntos. Lanza INSUFFICIENT_POINTS / USER_BANNED. Devuelve el saldo. */
export function debitPoints(userId: number, amount: number, o: PointsMoveOptions) {
  return rpc<number>("points_move", moveArgs(userId, amount, "debit", o));
}

/** Devuelve un gasto o una retención. Devuelve el saldo. */
export function refundPoints(userId: number, amount: number, o: PointsMoveOptions) {
  return rpc<number>("points_move", moveArgs(userId, amount, "refund", o));
}

/** Quita puntos ganados (admin). Lanza INSUFFICIENT_POINTS. Devuelve el saldo. */
export function revokePoints(userId: number, amount: number, o: PointsMoveOptions) {
  return rpc<number>("points_move", moveArgs(userId, amount, "revoke", o));
}

/** Pone a cero el saldo (admin). */
export function resetPoints(userId: number) {
  return rpc<number>("points_reset", { p_user_id: userId });
}

export type WatchHeartbeatResult = {
  awarded: number;
  balance: number;
  next_in: number;
  cap_reached: boolean;
};

export function watchHeartbeat(
  userId: number,
  intervalSeconds: number,
  points: number,
  dailyCap: number | null
) {
  return rpc<WatchHeartbeatResult>("watch_heartbeat", {
    p_user_id: userId,
    p_interval_seconds: intervalSeconds,
    p_points: points,
    p_daily_cap: dailyCap,
  });
}

export type RedeemProductResult = {
  order_id: number;
  status: number;
  total: number;
  created_at: number;
  sendable: boolean;
  /** Código entregado si el producto es `sendable`. */
  code: string | null;
  balance: number;
};

export function redeemProductAtomic(userId: number, productId: number) {
  return rpc<RedeemProductResult>("redeem_product", {
    p_user_id: userId,
    p_product_id: productId,
  });
}

export type BuyTicketResult = {
  entry_id: number;
  giveaway_id: number;
  user_id: number;
  balance: number;
};

export function buyGiveawayTicketAtomic(userId: number, giveawayId: number) {
  return rpc<BuyTicketResult>("buy_giveaway_ticket", {
    p_user_id: userId,
    p_giveaway_id: giveawayId,
  });
}

export type PlaceBidResult = {
  bid_id: number;
  product_id: number;
  amount: number;
  created_at: number;
  auction_round: number;
  min_bid_increment: number;
  auction_ends_at: number;
  /** Usuario al que se le ha devuelto la retención (null si no había o era el mismo). */
  previous_bidder_user_id: number | null;
  previous_amount: number;
  balance: number;
};

/** Puja reteniendo puntos. BID_TOO_LOW trae la puja mínima en `error.detail`. */
export function placeBidAtomic(userId: number, productId: number, amount: number) {
  return rpc<PlaceBidResult>("place_bid", {
    p_user_id: userId,
    p_product_id: productId,
    p_amount: amount,
  });
}

/** Devuelve la retención del mejor postor de una subasta no adjudicada. */
export function releaseAuctionHold(productId: number) {
  return rpc<{ released: number; user_id: number | null }>("auction_release_hold", {
    p_product_id: productId,
  });
}

export type OpenLootBoxResult = {
  opening_id: number;
  box_id: number;
  prize_id: number;
  prize_name: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  kind: "points" | "item";
  points_awarded: number;
  status: "completed" | "pending";
  balance: number;
};

/**
 * Abre una caja con un premio ya sorteado por el back (utils/lootBoxes).
 * Cobro, stock, registro y abono en una transacción. Lanza BOX_NOT_FOUND,
 * BOX_NOT_ACTIVE, PRIZE_UNAVAILABLE, PRIZE_OUT_OF_STOCK, USER_NOT_FOUND,
 * USER_KICK_ID_NOT_FOUND, USER_BANNED, INSUFFICIENT_POINTS.
 */
export function openLootBoxAtomic(userId: number, boxId: number, prizeId: number) {
  return rpc<OpenLootBoxResult>("open_loot_box", {
    p_user_id: userId,
    p_box_id: boxId,
    p_prize_id: prizeId,
  });
}
