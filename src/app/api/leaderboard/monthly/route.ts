import { NextRequest, NextResponse } from "next/server";

import { economyErrorResponse, findEconomyUser } from "@/app/utils/economy/db";
import { getMonthlyLeaderboard } from "@/app/utils/economy/leaderboard";
import { MONTH_RE, adMonth } from "@/app/utils/economy/time";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") || adMonth();
  const discordId = searchParams.get("discord_id");

  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ success: false, error: "INVALID_MONTH" }, { status: 400 });
  }

  try {
    const user = discordId ? await findEconomyUser(discordId) : null;
    return NextResponse.json({
      success: true,
      data: await getMonthlyLeaderboard(month, user?.id ?? null),
    });
  } catch (error) {
    return economyErrorResponse(error, "Error fetching monthly leaderboard");
  }
}
