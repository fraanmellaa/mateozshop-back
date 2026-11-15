import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Pujas: llamada a `place_bid` (migración 0023) y traducción de sus errores.
 * `utils/points` solo conoce los códigos antiguos, por eso esta tienda tiene su
 * propio envoltorio.
 */

export type ShopBidErrorCode =
  | "INVALID_AMOUNT"
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_NOT_AUCTION"
  | "AUCTION_NOT_ACTIVE"
  | "OUT_OF_STOCK"
  | "AUCTION_MISSING_END_DATE"
  | "AUCTION_ENDED"
  | "USER_NOT_FOUND"
  | "USER_BANNED"
  | "ADULT_REQUIRED"
  | "USER_ACCOUNT_NOT_LINKED"
  | "ACCOUNT_TOO_NEW"
  | "TRADE_LINK_REQUIRED"
  | "MONTHLY_WIN_CAP_REACHED"
  | "BID_TOO_LOW"
  | "INSUFFICIENT_POINTS";

const STATUS: Record<ShopBidErrorCode, number> = {
  INVALID_AMOUNT: 400,
  PRODUCT_NOT_FOUND: 404,
  PRODUCT_NOT_AUCTION: 400,
  AUCTION_NOT_ACTIVE: 409,
  OUT_OF_STOCK: 409,
  AUCTION_MISSING_END_DATE: 409,
  AUCTION_ENDED: 409,
  USER_NOT_FOUND: 404,
  USER_BANNED: 403,
  ADULT_REQUIRED: 403,
  USER_ACCOUNT_NOT_LINKED: 409,
  ACCOUNT_TOO_NEW: 403,
  TRADE_LINK_REQUIRED: 409,
  MONTHLY_WIN_CAP_REACHED: 409,
  BID_TOO_LOW: 400,
  INSUFFICIENT_POINTS: 400,
};

export class ShopBidError extends Error {
  code: ShopBidErrorCode;
  detail: string | null;

  constructor(code: ShopBidErrorCode, detail: string | null = null) {
    super(code);
    this.name = "ShopBidError";
    this.code = code;
    this.detail = detail;
  }
}

export type PlaceBidResult = {
  bid_id: number;
  product_id: number;
  amount: number;
  created_at: number;
  auction_round: number;
  min_bid_increment: number;
  auction_status: "in_progress";
  auction_ends_at: number;
  /** true si esta puja ha alargado la cuenta atrás. */
  extended: boolean;
  min_next_bid: number;
  /** Usuario al que se le ha devuelto la retención (null si no había o era el mismo). */
  previous_bidder_user_id: number | null;
  previous_amount: number;
  balance: number;
};

/** Puja reteniendo puntos y devolviendo los del superado, todo en una transacción. */
export async function placeBid(userId: number, productId: number, amount: number) {
  const { data, error } = await getSupabaseAdmin().rpc("place_bid", {
    p_user_id: userId,
    p_product_id: productId,
    p_amount: amount,
  });

  if (error) {
    const message = String(error.message || "").trim();
    if (message in STATUS) {
      throw new ShopBidError(message as ShopBidErrorCode, error.details ?? null);
    }
    throw new Error(`place_bid failed: ${message || "unknown error"}`);
  }

  return data as PlaceBidResult;
}

/** Respuesta HTTP de un error de negocio de la puja, o null si no lo es. */
export function shopBidErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof ShopBidError)) return null;

  // Nombre que ya usaba el front en las rutas web.
  const code = error.code === "INSUFFICIENT_POINTS" ? "NOT_ENOUGH_POINTS" : error.code;
  const n = error.detail !== null ? Number(error.detail) : NaN;

  let extra: Record<string, number> = {};
  if (Number.isFinite(n)) {
    if (error.code === "BID_TOO_LOW") extra = { minBid: n };
    else if (error.code === "ACCOUNT_TOO_NEW") extra = { minDays: n };
    else if (error.code === "MONTHLY_WIN_CAP_REACHED") extra = { cap: n };
  }

  return NextResponse.json(
    { success: false, error: code, ...extra },
    { status: STATUS[error.code] }
  );
}
