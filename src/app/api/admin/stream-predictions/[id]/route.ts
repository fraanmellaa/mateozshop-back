import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import {
  cancelStreamPrediction,
  closeStreamPrediction,
  resolveStreamPrediction,
  STREAM_PREDICTION_MESSAGES,
  StreamPredictionError,
} from "@/app/utils/streamPredictions";
import { adminActionSchema } from "@/app/utils/streamPredictions/schema";

type Params = { params: Promise<{ id: string }> };

// Acciones sobre una predicción del directo: cerrar la votación, poner el
// resultado (elige al ganador y le paga) o anularla.
export async function POST(request: NextRequest, { params }: Params) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const rawId = (await params).id;
  if (!/^\d{1,15}$/.test(rawId)) {
    return NextResponse.json({ success: false, error: "ID no válido" }, { status: 400 });
  }
  const id = Number(rawId);

  const parsed = adminActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || "Datos no válidos" },
      { status: 400 }
    );
  }

  try {
    const action = parsed.data;
    if (action.action === "close") {
      await closeStreamPrediction(id);
      return NextResponse.json({ success: true });
    }
    if (action.action === "cancel") {
      await cancelStreamPrediction(id);
      return NextResponse.json({ success: true });
    }
    const result = await resolveStreamPrediction(id, { option: action.option, number: action.number });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof StreamPredictionError) {
      return NextResponse.json(
        { success: false, code: error.code, error: STREAM_PREDICTION_MESSAGES[error.code] ?? error.code },
        { status: error.status }
      );
    }
    console.error("Error updating stream prediction:", error);
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 });
  }
}
