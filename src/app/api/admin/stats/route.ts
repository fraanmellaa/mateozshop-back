import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { DEFAULT_STATS_PERIODS, STATS_MIGRATION_ERROR, getAdminStats } from "@/app/utils/stats";

// Números del panel: /api/admin/stats?unit=week|month&periods=12
export async function GET(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const params = request.nextUrl.searchParams;
  const unit = params.get("unit") === "month" ? "month" : "week";
  const periods = Number(params.get("periods") ?? DEFAULT_STATS_PERIODS);

  try {
    const stats = await getAdminStats(unit, Number.isFinite(periods) ? periods : DEFAULT_STATS_PERIODS);
    if (!stats) {
      return NextResponse.json({ success: false, error: "STATS_UNAVAILABLE", message: STATS_MIGRATION_ERROR }, { status: 503 });
    }
    return NextResponse.json({ success: true, result: stats });
  } catch (error) {
    console.error("Error loading admin stats:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
