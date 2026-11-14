import { NextRequest, NextResponse } from "next/server";

import { requireCron } from "@/app/utils/cronAuth";
import { processTikTokLeaderboardsTick } from "@/app/utils/tiktok/leaderboards";
import { purgePastLeaderboardsCache } from "@/app/utils/frontendCache";

// Al finalizar se refrescan los contadores de los vídeos antes del snapshot.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const unauthorized = requireCron(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await processTikTokLeaderboardsTick();

    let cachePurge = null;
    if (result.finalized > 0) {
      cachePurge = await purgePastLeaderboardsCache().catch((error) => {
        console.error("[CRON] Error purgando caché de leaderboards:", error);
        return null;
      });
    }

    return NextResponse.json(
      {
        success: result.errors.length === 0,
        result,
        cachePurge,
      },
      { status: result.errors.length === 0 ? 200 : 500 }
    );
  } catch (error) {
    console.error("[CRON] Error procesando TikTok leaderboards:", error);
    return NextResponse.json(
      {
        success: false,
        error: "INTERNAL_SERVER_ERROR",
      },
      { status: 500 }
    );
  }
}
