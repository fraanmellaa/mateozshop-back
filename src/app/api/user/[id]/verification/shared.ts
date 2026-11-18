import { NextResponse } from "next/server";

import { VipUnavailableError } from "@/app/utils/points/vip";
import { VerificationError } from "@/app/utils/verification";

// Respuestas de error comunes a las rutas de verificación del usuario.

const STATUS: Record<string, number> = {
  INVALID_REQUEST: 400,
  PROOF_REQUIRED: 400,
  USER_NOT_FOUND: 404,
  USER_BANNED: 403,
  REQUEST_PENDING: 409,
  CASINO_ALREADY_VERIFIED: 409,
  CASINO_USER_TAKEN: 409,
};

export const fail = (error: string, status: number) =>
  NextResponse.json({ success: false, error }, { status });

export function failure(error: unknown) {
  if (error instanceof VipUnavailableError) return fail("VERIFICATION_UNAVAILABLE", 503);
  if (error instanceof VerificationError) return fail(error.code, STATUS[error.code] ?? 400);
  console.error("Error in user verification:", error);
  return fail("INTERNAL_SERVER_ERROR", 500);
}
