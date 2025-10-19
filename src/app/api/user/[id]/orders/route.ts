import { getUserOrders } from "@/app/utils/orders";

import { getUserByDiscordId } from "@/app/utils/users";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const discord_id = resolvedParams.id;

  const user = await getUserByDiscordId(discord_id);

  if (!user) {
    return NextResponse.json(
      { success: false, error: "USER_NOT_FOUND" },
      { status: 404 }
    );
  }

  const orders = await getUserOrders(user.id);

  return NextResponse.json(
    {
      success: true,
      data: orders,
    },
    {
      status: 200,
    }
  );
}
