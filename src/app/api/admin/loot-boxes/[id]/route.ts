import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { deleteLootBox, updateLootBox } from "@/app/utils/lootBoxes";
import { adminErrorResponse, invalidId, parseId, readJson } from "@/app/utils/lootBoxes/http";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const boxId = parseId((await params).id);
  if (!boxId) return invalidId();

  try {
    const box = await updateLootBox(boxId, await readJson(request));
    return NextResponse.json({ success: true, result: box });
  } catch (error) {
    return adminErrorResponse(error, "Error updating loot box");
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const boxId = parseId((await params).id);
  if (!boxId) return invalidId();

  try {
    await deleteLootBox(boxId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return adminErrorResponse(error, "Error deleting loot box");
  }
}
