import { NextRequest, NextResponse } from "next/server";

import { processTikTokLeaderboardsTick } from "@/app/utils/tiktok/leaderboards";
import { purgePastLeaderboardsCache } from "@/app/utils/frontendCache";

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

    const result = await processTikTokLeaderboardsTick();

    let cachePurge = null;
    if ((result.finalized || 0) > 0) {
      cachePurge = await purgePastLeaderboardsCache();
    }

    return NextResponse.json(
      {
        success: true,
        result,
        cachePurge,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[CRON] Error procesando TikTok leaderboards:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Error interno del servidor",
      },
      { status: 500 }
    );
  }
}
