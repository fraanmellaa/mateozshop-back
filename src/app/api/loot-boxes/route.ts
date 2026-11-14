import { NextResponse } from "next/server";

import { getPublicLootBoxes } from "@/app/utils/lootBoxes";

export async function GET() {
  try {
    const result = await getPublicLootBoxes();
    return NextResponse.json({ success: true, result }, { status: 200 });
  } catch (error) {
    console.error("Error fetching loot boxes:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
