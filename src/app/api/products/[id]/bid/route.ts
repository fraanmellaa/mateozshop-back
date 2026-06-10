import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/drizzle";
import { product_bids, products, users } from "@/db/schema";
import { publishBidUpdated, publishUserNotification } from "@/app/utils/realtime";

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
    const result = await db.transaction(async (tx) => {
      const userRows = await tx
        .select()
        .from(users)
        .where(eq(users.discord_id, body.discord_id))
        .limit(1);

      const user = userRows[0];
      if (!user) {
        throw new Error("USER_NOT_FOUND");
      }

      const lockedRows = await tx.execute(sql`
        select
          id,
          price,
          stock,
          is_auction,
          min_bid_increment,
          auction_ends_at,
          auction_round,
          auction_status,
          auction_parent_product_id,
          current_bid,
          current_bidder_user_id
        from products
        where id = ${productId}
        for update
      `);

      const row = lockedRows.rows[0] as
        | {
            id: number;
            price: number;
            stock: number;
            is_auction: boolean;
            min_bid_increment: number;
            auction_ends_at: number | null;
            auction_round: number;
            auction_status: string;
            auction_parent_product_id: number | null;
            current_bid: number;
            current_bidder_user_id: number | null;
          }
        | undefined;

      if (!row) {
        throw new Error("PRODUCT_NOT_FOUND");
      }

      if (!row.is_auction) {
        throw new Error("PRODUCT_NOT_AUCTION");
      }

      if (row.stock <= 0) {
        throw new Error("OUT_OF_STOCK");
      }

      if (row.auction_status !== "in_progress") {
        throw new Error("AUCTION_NOT_OPEN");
      }

      if (!row.auction_ends_at) {
        throw new Error("AUCTION_MISSING_END_DATE");
      }

      if (row.auction_ends_at && now > row.auction_ends_at) {
        throw new Error("AUCTION_CLOSED");
      }

      const availablePoints = user.total_points - user.used_points;
      if (availablePoints < body.amount) {
        throw new Error("NOT_ENOUGH_POINTS");
      }

      const minBid = Math.max(row.price, row.current_bid + Math.max(1, row.min_bid_increment || 1));
      if (body.amount < minBid) {
        throw new Error(`BID_TOO_LOW:${minBid}`);
      }

      const previousBidderId = row.current_bidder_user_id;
      const previousBidAmount = row.current_bid;

      await tx.insert(product_bids).values({
        product_id: productId,
        user_id: user.id,
        amount: body.amount,
        auction_round: row.auction_round,
        status: "in_progress",
        created_at: now,
      });

      const updatedRows = await tx
        .update(products)
        .set({
          current_bid: body.amount,
          current_bidder_user_id: user.id,
        })
        .where(eq(products.id, productId))
        .returning();

      const updated = updatedRows[0];

      let outbidNotification:
        | {
            discordId: string;
            title: string;
            body: string;
            targetUrl: string;
          }
        | undefined;

      const exactOneStepOutbid =
        previousBidderId &&
        previousBidderId !== user.id &&
        body.amount === previousBidAmount + Math.max(1, row.min_bid_increment || 1);

      if (exactOneStepOutbid) {
        const previousBidderRows = await tx
          .select({
            discord_id: users.discord_id,
          })
          .from(users)
          .where(eq(users.id, previousBidderId))
          .limit(1);

        const previousBidder = previousBidderRows[0];

        if (previousBidder?.discord_id) {
          outbidNotification = {
            discordId: previousBidder.discord_id,
            title: "Te han sobrepujado",
            body: `${user.username} subio la puja a ${body.amount} puntos.`,
            targetUrl: `/puntos?auction=${productId}&open=1`,
          };
        }
      }

      return {
        bidderName: user.username,
        bidderImage: user.image,
        bidderId: user.id,
        amount: body.amount,
        minBidIncrement: updated?.min_bid_increment ?? row.min_bid_increment,
        auctionStatus: row.auction_status,
        auctionEndsAt: row.auction_ends_at,
        outbidNotification,
      };
    });

    await publishBidUpdated({
      productId,
      amount: result.amount,
      bidderName: result.bidderName,
      bidderImage: result.bidderImage,
      bidderId: result.bidderId,
      minBidIncrement: result.minBidIncrement,
      auctionStatus: result.auctionStatus,
      auctionEndsAt: result.auctionEndsAt,
    });

    if (result.outbidNotification) {
      await publishUserNotification({
        discordId: result.outbidNotification.discordId,
        type: "auction_outbid",
        title: result.outbidNotification.title,
        body: result.outbidNotification.body,
        productId,
        amount: result.amount,
        targetUrl: result.outbidNotification.targetUrl,
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          amount: result.amount,
          bidderName: result.bidderName,
          bidderImage: result.bidderImage,
          bidderId: result.bidderId,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";

    if (message === "USER_NOT_FOUND") {
      return NextResponse.json({ success: false, error: message }, { status: 404 });
    }
    if (message === "PRODUCT_NOT_FOUND") {
      return NextResponse.json({ success: false, error: message }, { status: 404 });
    }
    if (
      message === "PRODUCT_NOT_AUCTION" ||
      message === "OUT_OF_STOCK" ||
      message === "AUCTION_NOT_OPEN" ||
      message === "AUCTION_MISSING_END_DATE" ||
      message === "AUCTION_CLOSED" ||
      message === "NOT_ENOUGH_POINTS"
    ) {
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }

    if (message.startsWith("BID_TOO_LOW:")) {
      const minBid = Number(message.split(":")[1] || 0);
      return NextResponse.json(
        { success: false, error: "BID_TOO_LOW", minBid },
        { status: 400 }
      );
    }

    console.error("Error placing bid:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
