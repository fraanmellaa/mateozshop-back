import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { deleteBonus, updateBonus } from "@/app/utils/bonuses";
import { countryListsOverlap, updateBonusSchema } from "@/app/utils/bonuses/schema";
import { purgeBonusesCache } from "@/app/utils/frontendCache";

type Params = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  return /^\d{1,9}$/.test(raw) ? Number(raw) : null;
}

const invalidId = () =>
  NextResponse.json({ success: false, error: "ID no válido" }, { status: 400 });
const notFound = () =>
  NextResponse.json(
    { success: false, error: "Bono no encontrado" },
    { status: 404 }
  );
const serverError = () =>
  NextResponse.json(
    { success: false, error: "Error interno del servidor" },
    { status: 500 }
  );

export async function PUT(request: NextRequest, { params }: Params) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const id = parseId((await params).id);
  if (id === null) return invalidId();

  const body = await request.json().catch(() => null);
  const parsed = updateBonusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: parsed.error.issues[0]?.message || "Datos no válidos",
      },
      { status: 400 }
    );
  }

  // Solo se tocan los campos enviados: zod rellena con null los opcionales
  // ausentes y, sin este filtro, una edición parcial (publicar, activar) los borraría.
  const sent = new Set(Object.keys((body ?? {}) as object));
  const changes = Object.fromEntries(
    Object.entries(parsed.data).filter(([key]) => sent.has(key))
  ) as typeof parsed.data;

  const overlap = countryListsOverlap(changes);
  if (overlap) {
    return NextResponse.json({ success: false, error: overlap }, { status: 400 });
  }

  try {
    const bonus = await updateBonus(id, changes);
    if (!bonus) return notFound();
    await purgeBonusesCache().catch(() => null);
    return NextResponse.json({ success: true, data: bonus });
  } catch (error) {
    console.error("Error updating bonus:", error);
    return serverError();
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const id = parseId((await params).id);
  if (id === null) return invalidId();

  try {
    const deleted = await deleteBonus(id);
    if (!deleted) return notFound();
    await purgeBonusesCache().catch(() => null);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting bonus:", error);
    return serverError();
  }
}
