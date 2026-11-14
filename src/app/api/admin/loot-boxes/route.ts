import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { createLootBox, getAdminLootBoxes } from "@/app/utils/lootBoxes";
import { adminErrorResponse, readJson } from "@/app/utils/lootBoxes/http";

export async function GET() {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const result = await getAdminLootBoxes();
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return adminErrorResponse(error, "Error fetching admin loot boxes");
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const box = await createLootBox(await readJson(request));
    return NextResponse.json({ success: true, result: box }, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error, "Error creating loot box");
  }
}
