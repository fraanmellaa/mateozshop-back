import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { deletePrediction, updatePrediction } from "@/app/utils/predictions";
import { updatePredictionSchema } from "@/app/utils/predictions/schema";

type Params = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  return /^\d{1,15}$/.test(raw) ? Number(raw) : null;
}

const invalidId = () =>
  NextResponse.json({ success: false, error: "ID no válido" }, { status: 400 });
const notFound = () =>
  NextResponse.json({ success: false, error: "Pronóstico no encontrado" }, { status: 404 });
const serverError = () =>
  NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 });

export async function PUT(request: NextRequest, { params }: Params) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const id = parseId((await params).id);
  if (id === null) return invalidId();

  const body = await request.json().catch(() => null);
  const parsed = updatePredictionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || "Datos no válidos" },
      { status: 400 }
    );
  }

  try {
    const prediction = await updatePrediction(id, parsed.data);
    if (!prediction) return notFound();
    return NextResponse.json({ success: true, data: prediction });
  } catch (error) {
    console.error("Error updating prediction:", error);
    return serverError();
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const id = parseId((await params).id);
  if (id === null) return invalidId();

  try {
    const deleted = await deletePrediction(id);
    if (!deleted) return notFound();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting prediction:", error);
    return serverError();
  }
}
