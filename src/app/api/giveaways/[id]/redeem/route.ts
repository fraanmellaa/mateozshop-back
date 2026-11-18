import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { accountErrorResponse } from "@/app/utils/accounts";
import { MAX_TICKETS_PER_PURCHASE, buyGiveawayTickets } from "@/app/utils/giveaways/tickets";
import { gateErrorResponse } from "@/app/utils/lootBoxes/gates";
import { pointsErrorResponse } from "@/app/utils/products/pointsErrors";
import { getUserByDiscordId } from "@/app/utils/users";
import { isResetBlocking } from "@/app/utils/economy/monthly";

const bodySchema = z.object({
  discord_id: z.string().min(1),
  // Cuántos tickets se compran de una vez (por defecto, uno).
  quantity: z.number().int().min(1).max(MAX_TICKETS_PER_PURCHASE).optional(),
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
    // Durante el reinicio mensual no se puja ni se compra: lo gastado ahora se
    // perdería (o quedaría retenido) al poner los saldos a cero.
    if (await isResetBlocking()) {
      return NextResponse.json(
        { success: false, error: "MONTHLY_RESET_IN_PROGRESS" },
        { status: 409 }
      );
    }

    const user = await getUserByDiscordId(parsed.data.discord_id);
    if (!user) {
      return NextResponse.json({ success: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }

    const result = await buyGiveawayTickets(user.id, giveawayId, parsed.data.quantity ?? 1);

    return NextResponse.json(
      { success: true, data: { entry_id: result.entry_id, balance: result.balance, tickets: result.tickets } },
      { status: 200 }
    );
  } catch (error) {
    const response =
      accountErrorResponse(error) ?? gateErrorResponse(error) ?? pointsErrorResponse(error);
    if (response) return response;

    console.error("Error buying giveaway ticket:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
