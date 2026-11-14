import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sendWinnerNotificationEmail } from "@/app/utils/email";
import { openLootBox } from "@/app/utils/lootBoxes";
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
  const boxId = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(boxId) || boxId <= 0) {
    return NextResponse.json({ success: false, error: "INVALID_BOX_ID" }, { status: 400 });
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

    // Sorteo en servidor + cobro, stock y registro en una transacción.
    const opened = await openLootBox(user.id, boxId);

    // La apertura ya existe: un fallo de email no la anula.
    if (opened.prize.kind === "item") {
      try {
        const sent = await sendWinnerNotificationEmail({
          to: user.email,
          subject: `Has ganado ${opened.prize.name}`,
          title: "¡Premio de caja!",
          intro: `Has ganado "${opened.prize.name}" al abrir una caja. Te lo entregaremos manualmente en cuanto sea posible.`,
          details: [`Premio: ${opened.prize.name}`],
        });
        if (!sent) console.error(`Loot box opening ${opened.opening_id}: winner email could not be sent`);
      } catch (error) {
        console.error(`Loot box opening ${opened.opening_id}: winner email failed`, error);
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          opening_id: opened.opening_id,
          prize: opened.prize,
          status: opened.status,
          balance: opened.balance,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const response = pointsErrorResponse(error);
    if (response) return response;

    console.error("Error opening loot box:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
