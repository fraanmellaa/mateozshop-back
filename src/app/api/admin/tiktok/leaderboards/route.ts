import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import {
  createTikTokLeaderboard,
  getAdminTikTokLeaderboards,
} from "@/app/utils/tiktok/leaderboards";

const VALIDATION_ERRORS = new Set([
  "LEADERBOARD_TITLE_REQUIRED",
  "LEADERBOARD_INVALID_DATES",
  "LEADERBOARD_INVALID_RANGE",
  "LEADERBOARD_END_IN_PAST",
  "LEADERBOARD_PRIZES_REQUIRED",
  "LEADERBOARD_PRIZES_DUPLICATED_POSITION",
  "LEADERBOARD_OVERLAP_NOT_ALLOWED",
]);

export async function GET() {
  if (!(await requireAdmin())) return adminUnauthorized();

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
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const body = await request.json().catch(() => null);

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

    if (VALIDATION_ERRORS.has(message)) {
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
