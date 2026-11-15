import { NextRequest, NextResponse } from "next/server";

import { accountErrorResponse } from "@/app/utils/accounts";
import { assertAdult } from "@/app/utils/accounts/adult";
import { economyErrorResponse, findEconomyUser } from "@/app/utils/economy/db";
import { openStreakBox } from "@/app/utils/economy/openings";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const user = await findEconomyUser(id);
    if (!user) {
      return NextResponse.json({ success: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }
    if (user.is_banned) {
      return NextResponse.json({ success: false, error: "USER_BANNED" }, { status: 403 });
    }
    assertAdult(user);

    return NextResponse.json({ success: true, data: await openStreakBox(user.id) });
  } catch (error) {
    return accountErrorResponse(error) ?? economyErrorResponse(error, "Error opening streak box");
  }
}
