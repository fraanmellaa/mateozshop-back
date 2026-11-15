import { NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { getAllLegalPages } from "@/app/utils/legal";

export async function GET() {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    return NextResponse.json({ success: true, result: await getAllLegalPages() });
  } catch (error) {
    console.error("Error fetching legal pages:", error);
    return NextResponse.json(
      { success: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
