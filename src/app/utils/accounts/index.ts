import { NextResponse } from "next/server";

import { AccountError } from "./errors";

export { AccountError };
export { assertAdult } from "./adult";
export { isAccountOldEnough } from "./age";

/** Respuesta HTTP para un AccountError; null si el error es de otro tipo. */
export function accountErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof AccountError)) return null;
  return NextResponse.json(
    { success: false, error: error.code, ...error.extra },
    { status: error.status }
  );
}
