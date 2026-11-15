import { NextRequest, NextResponse } from "next/server";

import { requireCron } from "@/app/utils/cronAuth";
import { runMonthlyReset } from "@/app/utils/economy/monthly";

export const maxDuration = 300;

/**
 * GET /api/cron/economy/monthly (cada hora). Solo actúa el día 1 a las 00:xx de
 * Andorra si el mes no está hecho, o para reanudar un reinicio a medias.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCron(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await runMonthlyReset();
    return NextResponse.json(
      { success: result.status !== "failed", timestamp: new Date().toISOString(), result },
      { status: result.status === "failed" ? 500 : 200 }
    );
  } catch (error) {
    console.error("[CRON] Error en el reinicio mensual:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
