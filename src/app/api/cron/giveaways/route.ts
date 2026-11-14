import { NextRequest, NextResponse } from "next/server";

import { requireCron } from "@/app/utils/cronAuth";
import { purgePastGiveawaysCache } from "@/app/utils/frontendCache";
import { processFinishedGiveaways } from "@/app/utils/giveaways/lottery";

/**
 * GET /api/cron/giveaways
 * Sortea los sorteos que han terminado y siguen sin cerrar.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCron(request);
  if (unauthorized) return unauthorized;

  try {
    const results = await processFinishedGiveaways();

    const successCount = results.filter((r) => r.success).length;
    const errorCount = results.length - successCount;

    let cachePurge = null;
    if (successCount > 0) {
      cachePurge = await purgePastGiveawaysCache();
    }

    return NextResponse.json(
      {
        success: true,
        timestamp: new Date().toISOString(),
        results,
        summary: {
          total: results.length,
          successful: successCount,
          errors: errorCount,
        },
        cachePurge,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[CRON] Error durante la revisión de sorteos:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
