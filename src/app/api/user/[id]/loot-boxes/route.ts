import { NextRequest, NextResponse } from "next/server";

import { getUserLootBoxOpenings } from "@/app/utils/lootBoxes";
import { getUserByDiscordId } from "@/app/utils/users";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const user = await getUserByDiscordId(id);
    if (!user) {
      return NextResponse.json({ success: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }

    const rows = await getUserLootBoxOpenings(user.id);
    return NextResponse.json(
      { success: true, result: rows },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching user loot box openings:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
