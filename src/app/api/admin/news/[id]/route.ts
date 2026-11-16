import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { purgeNewsCache } from "@/app/utils/frontendCache";
import { deleteNews, updateNews } from "@/app/utils/news";
import { updateNewsSchema } from "@/app/utils/news/schema";

type Params = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  return /^\d{1,15}$/.test(raw) ? Number(raw) : null;
}

const invalidId = () =>
  NextResponse.json({ success: false, error: "ID no válido" }, { status: 400 });
const notFound = () =>
  NextResponse.json({ success: false, error: "Novedad no encontrada" }, { status: 404 });
const serverError = () =>
  NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 });

export async function PUT(request: NextRequest, { params }: Params) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const id = parseId((await params).id);
  if (id === null) return invalidId();

  const body = await request.json().catch(() => null);
  const parsed = updateNewsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || "Datos no válidos" },
      { status: 400 }
    );
  }

  // Solo se tocan los campos que vienen en la petición: zod rellena con null
  // los opcionales ausentes y, sin este filtro, publicar o fijar los borraría.
  const sent = new Set(Object.keys(body as object));
  const changes = Object.fromEntries(
    Object.entries(parsed.data).filter(([key]) => sent.has(key))
  ) as typeof parsed.data;

  try {
    const news = await updateNews(id, changes);
    if (!news) return notFound();
    await purgeNewsCache().catch(() => null);
    return NextResponse.json({ success: true, data: news });
  } catch (error) {
    console.error("Error updating news:", error);
    return serverError();
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const id = parseId((await params).id);
  if (id === null) return invalidId();

  try {
    const deleted = await deleteNews(id);
    if (!deleted) return notFound();
    await purgeNewsCache().catch(() => null);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting news:", error);
    return serverError();
  }
}
