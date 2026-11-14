import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ExtensionUser, extensionError, requireExtensionUser } from "@/app/utils/extensionAuth";
import { isPointsError } from "@/app/utils/points";

import { GameError } from "./rounds";

/** Usuario de la extensión no baneado (heartbeat y juegos). */
export async function requireActiveExtensionUser(
  request: NextRequest
): Promise<{ ok: true; user: ExtensionUser } | { ok: false; response: NextResponse }> {
  const auth = await requireExtensionUser(request);
  if (auth.ok && auth.user.is_banned) {
    return { ok: false, response: extensionError("USER_BANNED", 403) };
  }
  return auth;
}

export function extensionOk(data: unknown) {
  return NextResponse.json({ success: true, data });
}

/** Lee y valida el cuerpo JSON; lanza INVALID_REQUEST_BODY si no encaja. */
export async function readBody<T>(request: NextRequest, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new GameError("INVALID_REQUEST_BODY", 400);
  return parsed.data;
}

const POINTS_ERROR_STATUS: Record<string, number> = {
  INSUFFICIENT_POINTS: 400,
  USER_BANNED: 403,
  USER_NOT_FOUND: 404,
};

/** Traduce un error a la respuesta del contrato, sin filtrar mensajes internos. */
export function extensionErrorResponse(error: unknown) {
  if (error instanceof GameError) return extensionError(error.code, error.status);
  if (isPointsError(error) && POINTS_ERROR_STATUS[error.code]) {
    return extensionError(error.code, POINTS_ERROR_STATUS[error.code]);
  }
  console.error("Extension API error:", error);
  return extensionError("INTERNAL_SERVER_ERROR", 500);
}
