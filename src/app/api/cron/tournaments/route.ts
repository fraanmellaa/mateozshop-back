import { NextRequest, NextResponse } from "next/server";

import { requireCron } from "@/app/utils/cronAuth";
import { closeExpiredTournaments } from "@/app/utils/games/tournament";

/**
 * GET /api/cron/tournaments
 * Cierra los torneos cuya hora de fin ya pasó y fija los ganadores del top 3.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCron(request);
  if (unauthorized) return unauthorized;

  try {
    const results = await closeExpiredTournaments();
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results,
      summary: {
        total: results.length,
        closed: results.filter((r) => r.ok).length,
        errors: results.filter((r) => !r.ok).length,
      },
    });
  } catch (error) {
    console.error("[CRON] Error cerrando torneos:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
