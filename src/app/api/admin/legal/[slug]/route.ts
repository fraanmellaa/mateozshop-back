import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { isLegalSlug, legalPageSchema, saveLegalPage } from "@/app/utils/legal";

type Params = { params: Promise<{ slug: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const { slug } = await params;
  if (!isLegalSlug(slug)) {
    return NextResponse.json({ success: false, error: "Página no encontrada" }, { status: 404 });
  }

  const parsed = legalPageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || "Datos no válidos" },
      { status: 400 }
    );
  }

  try {
    const page = await saveLegalPage(slug, parsed.data);
    return NextResponse.json({ success: true, data: page });
  } catch (error) {
    console.error("Error saving legal page:", error);
    return NextResponse.json(
      { success: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
