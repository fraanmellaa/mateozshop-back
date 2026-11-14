import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { buyGiveawayTicketAtomic } from "@/app/utils/points";
import { pointsErrorResponse } from "@/app/utils/products/pointsErrors";
import { getUserByDiscordId } from "@/app/utils/users";

const bodySchema = z.object({
  discord_id: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const giveawayId = Number(id);
  if (!Number.isInteger(giveawayId) || giveawayId <= 0) {
    return NextResponse.json({ success: false, error: "INVALID_GIVEAWAY_ID" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

  try {
    const user = await getUserByDiscordId(parsed.data.discord_id);
    if (!user) {
      return NextResponse.json({ success: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }

    const result = await buyGiveawayTicketAtomic(user.id, giveawayId);

    return NextResponse.json(
      { success: true, data: { entry_id: result.entry_id, balance: result.balance } },
      { status: 200 }
    );
  } catch (error) {
    const response = pointsErrorResponse(error);
    if (response) return response;

    console.error("Error buying giveaway ticket:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
