import { NextRequest, NextResponse } from "next/server";

import {
  disqualifyAndReallocateTikTokLeaderboardResult,
  updateTikTokLeaderboardResultReview,
} from "@/app/utils/tiktok/leaderboards";
import { purgePastLeaderboardsCache } from "@/app/utils/frontendCache";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ resultId: string }> }
) {
  try {
    const { resultId: resultIdParam } = await params;
    const resultId = Number(resultIdParam);

    if (!Number.isInteger(resultId) || resultId <= 0) {
      return NextResponse.json(
        { success: false, error: "INVALID_RESULT_ID" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const status = String(body?.status || "");

    if (
      status !== "pending_review" &&
      status !== "approved" &&
      status !== "rejected" &&
      status !== "prize_delivered" &&
      status !== "disqualified"
    ) {
      return NextResponse.json(
        { success: false, error: "INVALID_RESULT_STATUS" },
        { status: 400 }
      );
    }

    if (status === "disqualified") {
      await disqualifyAndReallocateTikTokLeaderboardResult({
        resultId,
        reviewNote: body?.review_note ? String(body.review_note) : undefined,
      });

      await purgePastLeaderboardsCache();

      return NextResponse.json({ success: true });
    }

    const updated = await updateTikTokLeaderboardResultReview({
      resultId,
      status,
      reviewNote: body?.review_note ? String(body.review_note) : undefined,
    });

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "RESULT_NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, result: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";

    if (
      message === "RESULT_NOT_FOUND" ||
      message === "LEADERBOARD_NOT_FOUND"
    ) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 404 }
      );
    }

    if (
      message === "RESULT_ALREADY_DISQUALIFIED" ||
      message === "LEADERBOARD_PRIZES_REQUIRED"
    ) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }

    console.error("Error updating leaderboard result status:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
