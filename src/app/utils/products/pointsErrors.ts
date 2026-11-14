import { NextResponse } from "next/server";

import { isPointsError } from "@/app/utils/points";

const STATUS: Record<string, number> = {
  USER_NOT_FOUND: 404,
  PRODUCT_NOT_FOUND: 404,
  GIVEAWAY_NOT_FOUND: 404,
  BOX_NOT_FOUND: 404,
  BOX_NOT_ACTIVE: 409,
  PRIZE_UNAVAILABLE: 409,
  PRIZE_OUT_OF_STOCK: 409,
  NO_PRIZES_AVAILABLE: 409,
  INVALID_AMOUNT: 400,
  AUCTION_PRODUCT_USE_BID: 400,
  PRODUCT_NOT_AUCTION: 400,
  BID_TOO_LOW: 400,
  NOT_ENOUGH_POINTS: 400,
  USER_BANNED: 403,
  USER_KICK_ID_NOT_FOUND: 409,
  OUT_OF_STOCK: 409,
  NO_CODES_AVAILABLE: 409,
  GIVEAWAY_NOT_STARTED: 409,
  GIVEAWAY_CLOSED: 409,
  AUCTION_NOT_ACTIVE: 409,
  AUCTION_MISSING_END_DATE: 409,
  AUCTION_ENDED: 409,
};

/**
 * Respuesta de la API web para un error de negocio de `utils/points`, o null
 * si el error no es de negocio (el llamador responde 500).
 */
export function pointsErrorResponse(error: unknown): NextResponse | null {
  if (!isPointsError(error)) return null;

  // Nombre que ya usaba el front en las rutas web.
  const code = error.code === "INSUFFICIENT_POINTS" ? "NOT_ENOUGH_POINTS" : error.code;
  const extra =
    error.code === "BID_TOO_LOW" && error.detail ? { minBid: Number(error.detail) } : {};

  return NextResponse.json(
    { success: false, error: code, ...extra },
    { status: STATUS[code] ?? 400 }
  );
}
