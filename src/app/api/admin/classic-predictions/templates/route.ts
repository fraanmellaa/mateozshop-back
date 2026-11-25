import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { saveClassicTemplate } from "@/app/utils/classicPredictions";
import { classicTemplateSchema } from "@/app/utils/classicPredictions/schema";

import { fail, invalid } from "../shared";

// Crea una predicción de serie: se abrirá sola en cada directo mientras esté activa.
export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const parsed = classicTemplateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);

  try {
    return NextResponse.json({ success: true, data: await saveClassicTemplate(null, parsed.data) }, { status: 201 });
  } catch (error) {
    return fail(error, "Error creating classic prediction template");
  }
}
