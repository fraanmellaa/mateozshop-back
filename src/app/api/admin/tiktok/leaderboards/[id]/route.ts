import { NextRequest, NextResponse } from "next/server";

import {
  deleteTikTokLeaderboard,
  getAdminTikTokLeaderboards,
  setTikTokLeaderboardStatus,
  TikTokLeaderboardStatus,
  updateTikTokLeaderboard,
} from "@/app/utils/tiktok/leaderboards";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = Number(idParam);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { success: false, error: "INVALID_LEADERBOARD_ID" },
        { status: 400 }
      );
    }

    const all = await getAdminTikTokLeaderboards();
    const leaderboard = all.find((item) => item.id === id);

    if (!leaderboard) {
      return NextResponse.json(
        { success: false, error: "LEADERBOARD_NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, result: leaderboard });
  } catch (error) {
    console.error("Error fetching TikTok leaderboard:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = Number(idParam);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { success: false, error: "INVALID_LEADERBOARD_ID" },
        { status: 400 }
      );
    }

    const body = await request.json();

    if (body?.action === "set_status") {
      const status = String(body?.status || "");

      if (
        status !== "scheduled" &&
        status !== "active" &&
        status !== "in_review" &&
        status !== "closed" &&
        status !== "cancelled"
      ) {
        return NextResponse.json(
          { success: false, error: "INVALID_LEADERBOARD_STATUS" },
          { status: 400 }
        );
      }

      await setTikTokLeaderboardStatus(
        id,
        status as TikTokLeaderboardStatus,
        body?.review_notes ? String(body.review_notes) : undefined
      );

      return NextResponse.json({ success: true });
    }

    await updateTikTokLeaderboard(id, {
      title: String(body?.title || ""),
      description: body?.description ? String(body.description) : null,
      start_at: Number(body?.start_at),
      end_at: Number(body?.end_at),
      prizes: Array.isArray(body?.prizes) ? body.prizes : [],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (
      message === "LEADERBOARD_NOT_FOUND" ||
      message === "LEADERBOARD_LOCKED_FOR_EDIT"
    ) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 404 }
      );
    }

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

    console.error("Error updating TikTok leaderboard:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = Number(idParam);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { success: false, error: "INVALID_LEADERBOARD_ID" },
        { status: 400 }
      );
    }

    await deleteTikTokLeaderboard(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting TikTok leaderboard:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
