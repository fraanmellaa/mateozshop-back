import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import {
  createStreamPrediction,
  getStreamPredictionSettings,
  listStreamPredictions,
  STREAM_PREDICTION_MESSAGES,
  StreamPredictionError,
} from "@/app/utils/streamPredictions";
import { createStreamPredictionSchema } from "@/app/utils/streamPredictions/schema";

const fail = (error: unknown, context: string) => {
  if (error instanceof StreamPredictionError) {
    return NextResponse.json(
      { success: false, code: error.code, error: STREAM_PREDICTION_MESSAGES[error.code] ?? error.code },
      { status: error.status }
    );
  }
  console.error(`${context}:`, error);
  return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 });
};

// Predicciones del directo: listado del panel.
export async function GET() {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const [list, settings] = await Promise.all([listStreamPredictions(), getStreamPredictionSettings()]);
    return NextResponse.json({ success: true, data: { ...list, settings } });
  } catch (error) {
    return fail(error, "Error listing stream predictions");
  }
}

// Abre una predicción (solo con el directo encendido y dentro del máximo por directo).
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return adminUnauthorized();

  const parsed = createStreamPredictionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || "Datos no válidos" },
      { status: 400 }
    );
  }

  try {
    const created = await createStreamPrediction(parsed.data, admin.username);
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    return fail(error, "Error creating stream prediction");
  }
}
