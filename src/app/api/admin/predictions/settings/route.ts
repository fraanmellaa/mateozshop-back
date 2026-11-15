import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { getPredictionSettings, savePredictionSettings } from "@/app/utils/predictions";

export async function GET() {
  if (!(await requireAdmin())) return adminUnauthorized();
  return NextResponse.json({ success: true, data: await getPredictionSettings() });
}

export async function PUT(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const body = await request.json().catch(() => null);
  try {
    const saved = await savePredictionSettings(body);
    if (!saved) {
      return NextResponse.json(
        { success: false, error: "Datos no válidos" },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true, data: saved });
  } catch (error) {
    console.error("Error saving prediction settings:", error);
    return NextResponse.json(
      { success: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
