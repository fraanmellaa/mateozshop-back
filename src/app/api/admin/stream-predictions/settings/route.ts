import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { saveStreamPredictionSettings } from "@/app/utils/streamPredictions";

// Ajustes de las predicciones del directo: puntos del ganador y máximo por directo.
export async function PUT(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const saved = await saveStreamPredictionSettings(await request.json().catch(() => null));
    if (!saved) {
      return NextResponse.json(
        { success: false, error: "Los puntos van de 1 a 1.000.000 y el máximo por directo de 0 a 20." },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true, data: saved });
  } catch (error) {
    console.error("Error saving stream prediction settings:", error);
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 });
  }
}
