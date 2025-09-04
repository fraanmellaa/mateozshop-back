import { getUserOrders } from "@/app/utils/orders";

import { getUserByKickId } from "@/app/utils/users";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const kick_id = resolvedParams.id;

  const user = await getUserByKickId(kick_id);

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
