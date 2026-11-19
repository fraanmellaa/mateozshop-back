import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { syncLiveState } from "@/app/utils/live";

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
  | "VERIFIED_REQUIRED"
  | "VIP_NOT_OPEN"
  | "NOT_AVAILABLE_YET"
  | "STREAM_OFFLINE"
  | "MAX_OPEN_AUCTIONS"
  | "MONTH_CLOSING"
  | "VIP_WIN_CAP_REACHED"
  | "VIP_ALREADY_LEADING"
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
  // Premio en puntos VIP y el usuario no está verificado (migración 0032).
  VERIFIED_REQUIRED: 403,
  // Cada premio VIP se abre en su fecha y solo durante su directo (migración 0039).
  VIP_NOT_OPEN: 409,
  // Abrir una puja (primera oferta), migración 0039: el premio aún no ha
  // llegado a su fecha «disponible desde»; no hay directo; ya hay el máximo de
  // pujas normales abiertas; o es el cierre de mes (último día desde las 23:00,
  // o reinicio mensual sin terminar).
  NOT_AVAILABLE_YET: 409,
  STREAM_OFFLINE: 409,
  MAX_OPEN_AUCTIONS: 409,
  MONTH_CLOSING: 409,
  // Como mucho un premio VIP por persona y mes: ya ganó uno, o lidera otro.
  VIP_WIN_CAP_REACHED: 409,
  VIP_ALREADY_LEADING: 409,
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
  /** Saldo que queda en la moneda del premio. */
  balance: number;
  /** Moneda del premio; ausente si falta la migración 0032 (= puntos normales). */
  currency?: "points" | "vip";
  /** true si esta puja ha abierto la puja (primera oferta). Ausente sin la 0039. */
  opened?: boolean;
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

const LIVE_RECHECK_MS = 15_000;
let lastLiveRecheck = 0;

/**
 * `place_bid` solo deja abrir una puja con el directo encendido, y eso lo sabe
 * por `stream_sessions`, que actualiza el tick de cada minuto. Si alguien abre
 * una puja justo al empezar el directo, el tick puede no haberlo visto todavía:
 * ante un STREAM_OFFLINE se vuelve a consultar Kick y Twitch (como mucho cada
 * 15 s por instancia) y, si hay directo, se reintenta la puja una vez.
 */
export async function placeBidWhenLive(userId: number, productId: number, amount: number) {
  try {
    return await placeBid(userId, productId, amount);
  } catch (error) {
    if (!(error instanceof ShopBidError) || error.code !== "STREAM_OFFLINE") throw error;
    if (Date.now() - lastLiveRecheck < LIVE_RECHECK_MS) throw error;
    lastLiveRecheck = Date.now();

    let live = false;
    try {
      live = (await syncLiveState()).live;
    } catch (syncError) {
      console.error("Error rechecking live state before a bid:", syncError);
    }
    if (!live) throw error;
    return placeBid(userId, productId, amount);
  }
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
    else if (error.code === "MAX_OPEN_AUCTIONS") extra = { maxOpen: n };
    else if (error.code === "NOT_AVAILABLE_YET") extra = { availableFrom: n };
  }

  return NextResponse.json(
    { success: false, error: code, ...extra },
    { status: STATUS[error.code] }
  );
}

/**
 * ¿Se retuvieron estos puntos antes de un reinicio de saldos? Si es así ya no
 * existen y no se devuelven (`auction_hold_voided`, migración 0039). Sin la
 * migración responde false: se devuelve como hasta ahora.
 */
export async function isHoldVoided(heldAt: number, currency: "points" | "vip"): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc("auction_hold_voided", {
    p_held_at: heldAt,
    p_currency: currency,
  });
  if (error) {
    if (error.code !== "PGRST202" && error.code !== "42883") {
      console.error("Error checking if a bid hold is voided:", error);
    }
    return false;
  }
  return data === true;
}
