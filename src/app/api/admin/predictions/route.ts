import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { createPrediction, getAllPredictions } from "@/app/utils/predictions";
import { createPredictionSchema } from "@/app/utils/predictions/schema";

export async function GET() {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const result = await getAllPredictions();
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Error fetching predictions:", error);
    return NextResponse.json(
      { success: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const body = await request.json().catch(() => null);
  const parsed = createPredictionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || "Datos no válidos" },
      { status: 400 }
    );
  }

  try {
    const prediction = await createPrediction(parsed.data);
    return NextResponse.json({ success: true, data: prediction }, { status: 201 });
  } catch (error) {
    console.error("Error creating prediction:", error);
    return NextResponse.json(
      { success: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
