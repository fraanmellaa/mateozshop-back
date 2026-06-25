import { NextRequest, NextResponse } from "next/server";

import {
  disqualifyAndReallocateTikTokLeaderboardResult,
  getTikTokLeaderboardResultById,
  updateTikTokLeaderboardResultReview,
} from "@/app/utils/tiktok/leaderboards";
import { sendWinnerNotificationEmail } from "@/app/utils/email";
import { publishUserNotification } from "@/app/utils/realtime";
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

    const current = await getTikTokLeaderboardResultById(resultId);

    if (!current) {
      return NextResponse.json(
        { success: false, error: "RESULT_NOT_FOUND" },
        { status: 404 }
      );
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

    if (status === "approved" && current.status !== "approved") {
      const leaderboardTitle = current.leaderboard?.title || "tu leaderboard de TikTok";
      const targetUrl = `${process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://mateozshop.com"}/tiktok/leaderboards/${current.leaderboard_id}`;

      if (current.user?.discord_id) {
        await publishUserNotification({
          discordId: current.user.discord_id,
          type: "leaderboard_won",
          title: "Has ganado una leaderboard",
          body: `Tu video ha quedado en el puesto #${current.position} de ${leaderboardTitle}.`,
          leaderboardId: current.leaderboard_id,
          leaderboardTitle,
          targetUrl,
        });
      }

      if (current.user?.email) {
        await sendWinnerNotificationEmail({
          to: current.user.email,
          subject: `Has ganado la leaderboard ${leaderboardTitle}`,
          title: "Has ganado una leaderboard",
          intro: `Tu video ha quedado premiado en ${leaderboardTitle}.`,
          details: [
            `Leaderboard: ${leaderboardTitle}`,
            `Puesto: #${current.position}`,
            `Premio: ${current.reward}`,
          ],
          ctaLabel: "Ver leaderboard",
          ctaUrl: targetUrl,
        });
      }
    }

    await purgePastLeaderboardsCache();

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
