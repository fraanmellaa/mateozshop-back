import { NextRequest, NextResponse } from "next/server";

import { getPublicTikTokLeaderboardById } from "@/app/utils/tiktok/leaderboards";
import { mockTikTokLeaderboardDetail } from "../mock";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = Number(idParam);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: "INVALID_ID",
        },
        { status: 400 }
      );
    }

    if (id === mockTikTokLeaderboardDetail.id) {
      return NextResponse.json(
        {
          success: true,
          result: mockTikTokLeaderboardDetail,
        },
        { status: 200 }
      );
    }

    const result = await getPublicTikTokLeaderboardById(id);

    if (!result) {
      return NextResponse.json(
        {
          success: false,
          error: "LEADERBOARD_NOT_FOUND",
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        result,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching TikTok leaderboard detail:", error);
    return NextResponse.json(
      {
        success: false,
        error: "INTERNAL_SERVER_ERROR",
      },
      { status: 500 }
    );
  }
}
