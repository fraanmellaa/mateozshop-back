import { NextResponse } from "next/server";
import type { z } from "zod";

import { CLASSIC_PREDICTION_MESSAGES, ClassicPredictionError } from "@/app/utils/classicPredictions";

// Respuestas comunes de las rutas del panel de Predicciones (Classic).

export function fail(error: unknown, context: string) {
  if (error instanceof ClassicPredictionError) {
    return NextResponse.json(
      { success: false, code: error.code, error: CLASSIC_PREDICTION_MESSAGES[error.code] ?? error.code },
      { status: error.status }
    );
  }
  console.error(`${context}:`, error);
  return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 });
}

export function invalid(error: z.ZodError) {
  return NextResponse.json(
    { success: false, error: error.issues[0]?.message || "Datos no válidos" },
    { status: 400 }
  );
}

/** Id numérico de la URL, o null si no lo es. */
export function parseId(raw: string): number | null {
  return /^\d{1,15}$/.test(raw) ? Number(raw) : null;
}

export const badId = () => NextResponse.json({ success: false, error: "ID no válido" }, { status: 400 });
