import { NextRequest, NextResponse } from "next/server";

import { requireCron } from "@/app/utils/cronAuth";
import { runEconomyTick } from "@/app/utils/economy/tick";

export const maxDuration = 60;

/** GET /api/cron/economy/tick (cada minuto): estado del directo y puntos por ver. */
export async function GET(request: NextRequest) {
  const unauthorized = requireCron(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await runEconomyTick();
    return NextResponse.json({ success: true, timestamp: new Date().toISOString(), result });
  } catch (error) {
    console.error("[CRON] Error en el tick de economía:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
