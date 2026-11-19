import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { createClassicPrediction, listClassicPredictionsForAdmin } from "@/app/utils/classicPredictions";
import { createClassicPredictionSchema } from "@/app/utils/classicPredictions/schema";

import { fail, invalid } from "./shared";

// Predicciones (Classic): listado del panel (predicciones de serie y las últimas abiertas).
export async function GET() {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    return NextResponse.json({ success: true, data: await listClassicPredictionsForAdmin() });
  } catch (error) {
    return fail(error, "Error listing classic predictions");
  }
}

// Abre una predicción ahora: la votación se cierra a mano, con temporizador o
// al acabar el directo.
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return adminUnauthorized();

  const parsed = createClassicPredictionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);

  try {
    const created = await createClassicPrediction(parsed.data, admin.username);
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    return fail(error, "Error creating classic prediction");
  }
}
