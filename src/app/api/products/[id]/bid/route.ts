import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { publishBidUpdated, publishUserNotification } from "@/app/utils/realtime";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: "mateoz" },
  }
);

const bodySchema = z.object({
  discord_id: z.string().min(1),
  amount: z.number().int().positive(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isFinite(productId)) {
    return NextResponse.json({ success: false, error: "INVALID_PRODUCT_ID" }, { status: 400 });
  }

  let body;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "INVALID_REQUEST_BODY", details: error.flatten() },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: false, error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);

  try {
    const [{ data: userRows, error: userError }, { data: productRows, error: productError }] =
      await Promise.all([
        supabase.from("users").select("*").eq("discord_id", body.discord_id).limit(1),
        supabase.from("products").select("*").eq("id", productId).limit(1),
      ]);

    if (userError || productError) {
      throw userError || productError;
    }

    const user = userRows?.[0];
    const product = productRows?.[0];

    if (!user) {
      return NextResponse.json({ success: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }

    if (!product) {
      return NextResponse.json({ success: false, error: "PRODUCT_NOT_FOUND" }, { status: 404 });
    }

    if (!product.is_auction) {
      return NextResponse.json({ success: false, error: "PRODUCT_NOT_AUCTION" }, { status: 400 });
    }

    if (product.stock <= 0) {
      return NextResponse.json({ success: false, error: "OUT_OF_STOCK" }, { status: 400 });
    }

    if (product.auction_status !== "in_progress") {
      return NextResponse.json({ success: false, error: "AUCTION_NOT_OPEN" }, { status: 400 });
    }

    if (!product.auction_ends_at) {
      return NextResponse.json({ success: false, error: "AUCTION_MISSING_END_DATE" }, { status: 400 });
    }

    if (now > product.auction_ends_at) {
      return NextResponse.json({ success: false, error: "AUCTION_CLOSED" }, { status: 400 });
    }

    const availablePoints = user.total_points - user.used_points;
    if (availablePoints < body.amount) {
      return NextResponse.json({ success: false, error: "NOT_ENOUGH_POINTS" }, { status: 400 });
    }

    const increment = Math.max(1, product.min_bid_increment || 1);
    const minBid = Math.max(product.price, product.current_bid + increment);
    if (body.amount < minBid) {
      return NextResponse.json({ success: false, error: "BID_TOO_LOW", minBid }, { status: 400 });
    }

    const previousBidderId = product.current_bidder_user_id;
    const previousBidAmount = product.current_bid;

    const { error: insertBidError } = await supabase.from("product_bids").insert({
      product_id: productId,
      user_id: user.id,
      amount: body.amount,
      auction_round: product.auction_round,
      status: "in_progress",
      created_at: now,
    });

    if (insertBidError) {
      throw insertBidError;
    }

    const { error: updateProductError } = await supabase
      .from("products")
      .update({
        current_bid: body.amount,
        current_bidder_user_id: user.id,
      })
      .eq("id", productId);

    if (updateProductError) {
      throw updateProductError;
    }

    await publishBidUpdated({
      productId,
      amount: body.amount,
      bidderName: user.username,
      bidderImage: user.image,
      bidderId: user.id,
      minBidIncrement: product.min_bid_increment,
      auctionStatus: product.auction_status,
      auctionEndsAt: product.auction_ends_at,
    });

    const exactOneStepOutbid =
      previousBidderId &&
      previousBidderId !== user.id &&
      body.amount === previousBidAmount + increment;

    if (exactOneStepOutbid) {
      const { data: previousBidderRows } = await supabase
        .from("users")
        .select("discord_id")
        .eq("id", previousBidderId)
        .limit(1);

      const previousBidderDiscordId = previousBidderRows?.[0]?.discord_id;
      if (previousBidderDiscordId) {
        await publishUserNotification({
          discordId: previousBidderDiscordId,
          type: "auction_outbid",
          title: "Te han sobrepujado",
          body: `${user.username} subio la puja a ${body.amount} puntos.`,
          productId,
          amount: body.amount,
          targetUrl: `/puntos?auction=${productId}&open=1`,
        });
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          amount: body.amount,
          bidderName: user.username,
          bidderImage: user.image,
          bidderId: user.id,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error placing bid:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
