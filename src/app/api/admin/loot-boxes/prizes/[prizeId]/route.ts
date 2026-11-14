import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { deleteLootBoxPrize, updateLootBoxPrize } from "@/app/utils/lootBoxes";
import { adminErrorResponse, invalidId, parseId, readJson } from "@/app/utils/lootBoxes/http";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ prizeId: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const prizeId = parseId((await params).prizeId);
  if (!prizeId) return invalidId();

  try {
    const prize = await updateLootBoxPrize(prizeId, await readJson(request));
    return NextResponse.json({ success: true, result: prize });
  } catch (error) {
    return adminErrorResponse(error, "Error updating loot box prize");
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ prizeId: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const prizeId = parseId((await params).prizeId);
  if (!prizeId) return invalidId();

  try {
    await deleteLootBoxPrize(prizeId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return adminErrorResponse(error, "Error deleting loot box prize");
  }
}
