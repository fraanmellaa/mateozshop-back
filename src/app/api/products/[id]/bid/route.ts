import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { placeBidAtomic } from "@/app/utils/points";
import { pointsErrorResponse } from "@/app/utils/products/pointsErrors";
import { publishBidUpdated, publishUserNotification } from "@/app/utils/realtime";
import { getUserByDiscordId } from "@/app/utils/users";

const bodySchema = z.object({
  discord_id: z.string().min(1),
  amount: z.number().int().positive().max(2_147_483_647),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ success: false, error: "INVALID_PRODUCT_ID" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "INVALID_REQUEST_BODY", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;

  try {
    const user = await getUserByDiscordId(body.discord_id);
    if (!user) {
      return NextResponse.json({ success: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }

    // Retiene los puntos del pujador y devuelve los del anterior, todo atómico.
    const bid = await placeBidAtomic(user.id, productId, body.amount);

    // La puja ya es firme: un fallo de Ably no debe devolver error al pujador.
    try {
      await publishBidUpdated({
        productId,
        amount: bid.amount,
        bidderName: user.username,
        bidderImage: user.image,
        bidderId: user.id,
        minBidIncrement: bid.min_bid_increment,
        auctionStatus: "in_progress",
        auctionEndsAt: bid.auction_ends_at,
      });

      if (bid.previous_bidder_user_id) {
        const { data: previousRows } = await getSupabaseAdmin()
          .from("users")
          .select("discord_id")
          .eq("id", bid.previous_bidder_user_id)
          .limit(1);

        const previousDiscordId = previousRows?.[0]?.discord_id;
        if (previousDiscordId) {
          await publishUserNotification({
            discordId: previousDiscordId,
            type: "auction_outbid",
            title: "Te han sobrepujado",
            body: `${user.username} subió la puja a ${bid.amount} puntos. Te hemos devuelto tus ${bid.previous_amount} puntos.`,
            productId,
            amount: bid.amount,
            targetUrl: `/puntos?auction=${productId}&open=1`,
          });
        }
      }
    } catch (error) {
      console.error("Error publishing bid update:", error);
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          amount: bid.amount,
          bidderName: user.username,
          bidderImage: user.image,
          bidderId: user.id,
          balance: bid.balance,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const response = pointsErrorResponse(error);
    if (response) return response;

    console.error("Error placing bid:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
