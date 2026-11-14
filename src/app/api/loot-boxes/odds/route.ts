import { NextResponse } from "next/server";

import { getLootBoxOdds } from "@/app/utils/lootBoxes";

export async function GET() {
  try {
    const result = await getLootBoxOdds();
    return NextResponse.json({ success: true, result }, { status: 200 });
  } catch (error) {
    console.error("Error fetching loot box odds:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
