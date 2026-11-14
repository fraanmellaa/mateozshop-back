import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import {
  claimTikTokWinnerNotification,
  disqualifyAndReallocateTikTokLeaderboardResult,
  updateTikTokLeaderboardResultReview,
} from "@/app/utils/tiktok/leaderboards";
import { sendWinnerNotificationEmail } from "@/app/utils/email";
import { publishUserNotification } from "@/app/utils/realtime";
import { purgePastLeaderboardsCache } from "@/app/utils/frontendCache";

// El estado actual del resultado o de su leaderboard no admite la operación.
const CONFLICT_ERRORS = new Set([
  "RESULT_DISQUALIFIED",
  "RESULT_WITHOUT_PRIZE",
  "RESULT_CHANGED_RETRY",
  "LEADERBOARD_CLOSED",
  "LEADERBOARD_NOT_IN_REVIEW",
]);

async function purgeCache() {
  try {
    await purgePastLeaderboardsCache();
  } catch (error) {
    console.error("Error purgando caché de leaderboards:", error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ resultId: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const { resultId: resultIdParam } = await params;
    const resultId = Number(resultIdParam);

    if (!Number.isInteger(resultId) || resultId <= 0) {
      return NextResponse.json(
        { success: false, error: "INVALID_RESULT_ID" },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => null);
    const status = String(body?.status || "");
    const reviewNote =
      typeof body?.review_note === "string" && body.review_note.trim()
        ? body.review_note
        : undefined;

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
      await disqualifyAndReallocateTikTokLeaderboardResult({ resultId, reviewNote });
      await purgeCache();

      return NextResponse.json({ success: true });
    }

    const { previous, updated } = await updateTikTokLeaderboardResultReview({
      resultId,
      status,
      reviewNote,
    });

    // El aviso de ganador sale una sola vez por resultado, aunque se apruebe,
    // se rechace y se vuelva a aprobar.
    if (status === "approved" && (await claimTikTokWinnerNotification(resultId))) {
      const leaderboardTitle = previous.leaderboard?.title || "tu leaderboard de TikTok";
      const targetUrl = `${process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://mateozshop.com"}/tiktok/leaderboards/${previous.leaderboard_id}`;

      try {
        if (previous.user?.discord_id) {
          await publishUserNotification({
            discordId: previous.user.discord_id,
            type: "leaderboard_won",
            title: "Has ganado una leaderboard",
            body: `Tu video ha quedado en el puesto #${previous.position} de ${leaderboardTitle}.`,
            leaderboardId: previous.leaderboard_id,
            leaderboardTitle,
            targetUrl,
          });
        }

        if (previous.user?.email) {
          await sendWinnerNotificationEmail({
            to: previous.user.email,
            subject: `Has ganado la leaderboard ${leaderboardTitle}`,
            title: "Has ganado una leaderboard",
            intro: `Tu video ha quedado premiado en ${leaderboardTitle}.`,
            details: [
              `Leaderboard: ${leaderboardTitle}`,
              `Puesto: #${previous.position}`,
              `Premio: ${previous.reward}`,
            ],
            ctaLabel: "Ver leaderboard",
            ctaUrl: targetUrl,
          });
        }
      } catch (error) {
        // La aprobación ya está guardada; el aviso no se reintenta solo.
        console.error("Error avisando al ganador de la leaderboard:", error);
      }
    }

    await purgeCache();

    return NextResponse.json({ success: true, result: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";

    if (message === "RESULT_NOT_FOUND") {
      return NextResponse.json(
        { success: false, error: message },
        { status: 404 }
      );
    }

    if (CONFLICT_ERRORS.has(message)) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 409 }
      );
    }

    console.error("Error updating leaderboard result status:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
