import { NextRequest, NextResponse } from "next/server";

import { processAuctionsTick } from "@/app/utils/auctions/process";
import { requireCron } from "@/app/utils/cronAuth";
import { purgePastAuctionsCache } from "@/app/utils/frontendCache";

export async function GET(request: NextRequest) {
  const unauthorized = requireCron(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await processAuctionsTick();

    let cachePurge = null;
    if (result.finalized > 0) {
      cachePurge = await purgePastAuctionsCache();
    }

    return NextResponse.json(
      {
        success: true,
        timestamp: new Date().toISOString(),
        result,
        cachePurge,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[CRON] Error procesando subastas:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
