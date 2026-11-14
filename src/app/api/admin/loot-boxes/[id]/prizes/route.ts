import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { createLootBoxPrize } from "@/app/utils/lootBoxes";
import { adminErrorResponse, invalidId, parseId, readJson } from "@/app/utils/lootBoxes/http";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const boxId = parseId((await params).id);
  if (!boxId) return invalidId();

  try {
    const prize = await createLootBoxPrize(boxId, await readJson(request));
    return NextResponse.json({ success: true, result: prize }, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error, "Error creating loot box prize");
  }
}
