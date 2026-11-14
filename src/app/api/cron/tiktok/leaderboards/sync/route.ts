import { NextRequest, NextResponse } from "next/server";

import { requireCron } from "@/app/utils/cronAuth";
import { getActiveLeaderboardVideoCandidates } from "@/app/utils/tiktok/leaderboards";
import { publishQStashTask } from "@/app/utils/qstash";

// La Display API de TikTok admite 20 vídeos por petición y cuenta de usuario.
const VIDEOS_PER_TASK = 20;
const PUBLISH_CONCURRENCY = 5;

export async function GET(request: NextRequest) {
  const unauthorized = requireCron(request);
  if (unauthorized) return unauthorized;

  try {
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

    // Una tarea por usuario y bloque de 20 vídeos: una sola petición a TikTok.
    const byUser = new Map<number, number[]>();
    for (const candidate of candidates) {
      const list = byUser.get(candidate.user_id) || [];
      list.push(candidate.video_row_id);
      byUser.set(candidate.user_id, list);
    }

    const tasks: number[][] = [];
    for (const rowIds of byUser.values()) {
      for (let i = 0; i < rowIds.length; i += VIDEOS_PER_TASK) {
        tasks.push(rowIds.slice(i, i + VIDEOS_PER_TASK));
      }
    }

    const results: Array<{
      success: boolean;
      video_row_ids: number[];
      messageId?: string | null;
      error?: string;
    }> = [];

    for (let i = 0; i < tasks.length; i += PUBLISH_CONCURRENCY) {
      const batch = await Promise.all(
        tasks.slice(i, i + PUBLISH_CONCURRENCY).map(async (videoRowIds) => {
          try {
            const payload = await publishQStashTask({
              destination,
              body: { video_row_ids: videoRowIds },
              forwardHeaders: {
                Authorization: `Bearer ${taskSecret}`,
              },
            });

            return {
              success: true,
              video_row_ids: videoRowIds,
              messageId: payload?.messageId || null,
            };
          } catch (error) {
            return {
              success: false,
              video_row_ids: videoRowIds,
              error: error instanceof Error ? error.message : "QSTASH_PUBLISH_FAILED",
            };
          }
        })
      );
      results.push(...batch);
    }

    return NextResponse.json(
      {
        success: true,
        total_videos: candidates.length,
        total: tasks.length,
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
        error: "INTERNAL_SERVER_ERROR",
      },
      { status: 500 }
    );
  }
}
