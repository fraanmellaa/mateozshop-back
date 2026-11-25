import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { deleteClassicTemplate, saveClassicTemplate } from "@/app/utils/classicPredictions";
import { classicTemplateSchema } from "@/app/utils/classicPredictions/schema";

import { badId, fail, invalid, parseId } from "../../shared";

type Params = { params: Promise<{ id: string }> };

// Edita una predicción de serie (textos, límites, activa o no). Se envía entera.
export async function PUT(request: NextRequest, { params }: Params) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const id = parseId((await params).id);
  if (id === null) return badId();

  const parsed = classicTemplateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);

  try {
    return NextResponse.json({ success: true, data: await saveClassicTemplate(id, parsed.data) });
  } catch (error) {
    return fail(error, "Error updating classic prediction template");
  }
}

// Borra una predicción de serie. Las que ya se abrieron a partir de ella siguen su curso.
export async function DELETE(_request: NextRequest, { params }: Params) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const id = parseId((await params).id);
  if (id === null) return badId();

  try {
    await deleteClassicTemplate(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error, "Error deleting classic prediction template");
  }
}
