import { NextRequest, NextResponse } from "next/server";

import {
  createTikTokLeaderboard,
  getAdminTikTokLeaderboards,
} from "@/app/utils/tiktok/leaderboards";

export async function GET() {
  try {
    const leaderboards = await getAdminTikTokLeaderboards();
    return NextResponse.json({ success: true, result: leaderboards });
  } catch (error) {
    console.error("Error fetching TikTok leaderboards:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const leaderboard = await createTikTokLeaderboard({
      title: String(body?.title || ""),
      description: body?.description ? String(body.description) : null,
      start_at: Number(body?.start_at),
      end_at: Number(body?.end_at),
      prizes: Array.isArray(body?.prizes) ? body.prizes : [],
    });

    return NextResponse.json(
      {
        success: true,
        result: leaderboard,
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (
      message === "LEADERBOARD_TITLE_REQUIRED" ||
      message === "LEADERBOARD_INVALID_DATES" ||
      message === "LEADERBOARD_INVALID_RANGE" ||
      message === "LEADERBOARD_PRIZES_REQUIRED" ||
      message === "LEADERBOARD_PRIZES_DUPLICATED_POSITION" ||
      message === "LEADERBOARD_OVERLAP_NOT_ALLOWED"
    ) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }

    console.error("Error creating TikTok leaderboard:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
