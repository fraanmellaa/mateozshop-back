import { NextRequest, NextResponse } from "next/server";

import { economyErrorResponse, findEconomyUser } from "@/app/utils/economy/db";
import { getUserEconomy } from "@/app/utils/economy/user";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const user = await findEconomyUser(id);
    if (!user) {
      return NextResponse.json({ success: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: await getUserEconomy(user.id) });
  } catch (error) {
    return economyErrorResponse(error, "Error fetching user economy");
  }
}
