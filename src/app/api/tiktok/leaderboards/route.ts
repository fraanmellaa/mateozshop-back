import { NextResponse } from "next/server";

import { getPublicTikTokLeaderboards } from "@/app/utils/tiktok/leaderboards";
import { mockTikTokLeaderboards } from "./mock";

export async function GET() {
  try {
    return NextResponse.json(
      {
        success: true,
        result: mockTikTokLeaderboards,
      },
      { status: 200 }
    );

    const result = await getPublicTikTokLeaderboards();

    return NextResponse.json(
      {
        success: true,
        result,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching TikTok leaderboards:", error);
    return NextResponse.json(
      {
        success: false,
        error: "INTERNAL_SERVER_ERROR",
      },
      { status: 500 }
    );
  }
}
