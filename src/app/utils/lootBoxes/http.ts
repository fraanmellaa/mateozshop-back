import { NextResponse } from "next/server";

import { LootBoxError } from "./rules";

/** Id numérico de una ruta, o null si no es un entero positivo. */
export function parseId(value: string): number | null {
  const n = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function invalidId() {
  return NextResponse.json(
    { success: false, error: "INVALID_ID", message: "Identificador no válido." },
    { status: 400 }
  );
}

/** Respuesta de las rutas admin: errores de reglas con código y mensaje en español. */
export function adminErrorResponse(error: unknown, context: string) {
  if (error instanceof LootBoxError) {
    return NextResponse.json(
      { success: false, error: error.code, message: error.message },
      { status: error.status }
    );
  }
  console.error(`${context}:`, error);
  return NextResponse.json(
    { success: false, error: "INTERNAL_SERVER_ERROR", message: "Error interno del servidor." },
    { status: 500 }
  );
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
