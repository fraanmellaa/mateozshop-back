import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { placeBidWhenLive, shopBidErrorResponse } from "@/app/utils/shop/bids";
import { publishBidUpdated, publishUserNotification } from "@/app/utils/realtime";
import { RATE_RULES, rateLimit, tooManyRequests } from "@/app/utils/rateLimit";
import { getUserByDiscordId } from "@/app/utils/users";
import { isResetBlocking } from "@/app/utils/economy/monthly";
import { clientIpFromHeaders, recordUserIp } from "@/app/utils/orders/duplicates";

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

  if (!(await rateLimit(`bid:${body.discord_id}`, RATE_RULES.bid))) return tooManyRequests(RATE_RULES.bid);

  try {
    // Durante el reinicio mensual no se puja ni se compra: lo gastado ahora se
    // perdería (o quedaría retenido) al poner los saldos a cero.
    if (await isResetBlocking()) {
      return NextResponse.json(
        { success: false, error: "MONTHLY_RESET_IN_PROGRESS" },
        { status: 409 }
      );
    }

    const user = await getUserByDiscordId(body.discord_id);
    if (!user) {
      return NextResponse.json({ success: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }

    // Retiene los puntos del pujador y devuelve los del anterior, todo atómico.
    // Abrir una puja exige directo encendido: si el tick aún no lo ha visto, se
    // comprueba en el momento (ver placeBidWhenLive).
    const bid = await placeBidWhenLive(user.id, productId, body.amount);

    // IP del pujador (la reenvía la web): solo sirve para avisar en el panel de
    // posibles cuentas repetidas. No bloquea nada ni puede fallar la puja.
    const clientIp = clientIpFromHeaders(request.headers);
    if (clientIp) after(() => recordUserIp(user.id, clientIp));

    // La puja ya es firme: un fallo de Ably no debe devolver error al pujador.
    try {
      await publishBidUpdated({
        productId,
        amount: bid.amount,
        bidderName: user.username,
        bidderImage: user.image,
        bidderId: user.id,
        minBidIncrement: bid.min_bid_increment,
        auctionStatus: bid.auction_status,
        auctionEndsAt: bid.auction_ends_at,
      });

      // previous_amount llega a 0 si esos puntos eran de antes de un reinicio de
      // saldos: no se le ha devuelto nada, así que no se le avisa de lo contrario.
      if (bid.previous_bidder_user_id && bid.previous_amount > 0) {
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
            body: `${user.username} subió la puja a ${bid.amount} ${bid.currency === "vip" ? "puntos VIP" : "puntos"}. Te hemos devuelto tus ${bid.previous_amount} ${bid.currency === "vip" ? "puntos VIP" : "puntos"}.`,
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
          // Saldo que queda en la moneda del premio (`currency`).
          balance: bid.balance,
          currency: bid.currency === "vip" ? "vip" : "points",
          auctionEndsAt: bid.auction_ends_at,
          minNextBid: bid.min_next_bid,
          extended: bid.extended,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const response = shopBidErrorResponse(error);
    if (response) return response;

    console.error("Error placing bid:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
