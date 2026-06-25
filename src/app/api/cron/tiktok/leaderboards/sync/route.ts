import { NextRequest, NextResponse } from "next/server";

import { getActiveLeaderboardVideoCandidates } from "@/app/utils/tiktok/leaderboards";
import { publishQStashTask } from "@/app/utils/qstash";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        {
          success: false,
          error: "No autorizado",
        },
        { status: 401 }
      );
    }

    const backendBaseUrl = process.env.BACKEND_BASE_URL;
    const taskSecret = process.env.TIKTOK_LEADERBOARD_TASK_SECRET;

    if (!backendBaseUrl || !taskSecret) {
      return NextResponse.json(
        {
          success: false,
          error: "TASK_SYNC_NOT_CONFIGURED",
        },
        { status: 500 }
      );
    }

    const candidates = await getActiveLeaderboardVideoCandidates();
    const destination = new URL(
      "/api/tasks/tiktok/leaderboards/video-refresh",
      backendBaseUrl
    ).toString();

    const results = await Promise.all(
      candidates.map(async (candidate) => {
        try {
          const payload = await publishQStashTask({
            destination,
            body: {
              leaderboard_id: candidate.leaderboard_id,
              video_row_id: candidate.video_row_id,
              video_id: candidate.video_id,
            },
            forwardHeaders: {
              Authorization: `Bearer ${taskSecret}`,
            },
          });

          return {
            success: true,
            video_row_id: candidate.video_row_id,
            messageId: payload?.messageId || null,
          };
        } catch (error) {
          return {
            success: false,
            video_row_id: candidate.video_row_id,
            error: error instanceof Error ? error.message : "QSTASH_PUBLISH_FAILED",
          };
        }
      })
    );

    return NextResponse.json(
      {
        success: true,
        total: candidates.length,
        queued: results.filter((result) => result.success).length,
        failed: results.filter((result) => !result.success).length,
        results,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[CRON] Error encolando refresco TikTok leaderboard:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR",
      },
      { status: 500 }
    );
  }
}
