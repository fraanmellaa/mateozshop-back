import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { getAdminLeaderboardLiveRanking } from "@/app/utils/tiktok/leaderboards";

// Ranking en vivo para el panel: todos los vídeos asociados a la leaderboard,
// con su puesto si cuentan y el motivo de exclusión si no.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const id = Number((await params).id);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { success: false, error: "INVALID_LEADERBOARD_ID" },
        { status: 400 }
      );
    }

    const result = await getAdminLeaderboardLiveRanking(id);

    if (!result) {
      return NextResponse.json(
        { success: false, error: "LEADERBOARD_NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Error fetching TikTok leaderboard live ranking:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
