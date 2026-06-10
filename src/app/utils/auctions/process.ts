import { and, asc, desc, eq, lte, sql } from "drizzle-orm";

import { publishBidUpdated } from "@/app/utils/realtime";
import { db } from "@/db/drizzle";
import { orders, product_bids, products, users } from "@/db/schema";

export async function processAuctionsTick() {
  const now = Math.floor(Date.now() / 1000);

  const endedAuctions = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.is_auction, true),
        eq(products.auction_status, "in_progress"),
        lte(products.auction_ends_at, now)
      )
    )
    .limit(100);

  let movedToFinalizing = 0;
  let finalized = 0;
  let reopened = 0;

  for (const auction of endedAuctions) {
    const updated = await db.transaction(async (tx) => {
      const lockedRows = await tx.execute(sql`
        select id, auction_round, auction_status, min_bid_increment
        from products
        where id = ${auction.id}
        for update
      `);

      const row = lockedRows.rows[0] as
        | {
            id: number;
            auction_round: number;
            auction_status: string;
            min_bid_increment: number;
          }
        | undefined;

      if (!row || row.auction_status !== "in_progress") return null;

      await tx
        .update(products)
        .set({
          auction_status: "finalizing",
          auction_prize_assigned: false,
        })
        .where(eq(products.id, row.id));

      await tx
        .update(product_bids)
        .set({ status: "finalizing" })
        .where(
          and(
            eq(product_bids.product_id, row.id),
            eq(product_bids.auction_round, row.auction_round),
            eq(product_bids.status, "in_progress")
          )
        );

      return { id: row.id, minBidIncrement: row.min_bid_increment };
    });

    if (updated) {
      movedToFinalizing += 1;
      await publishBidUpdated({
        productId: updated.id,
        amount: 0,
        minBidIncrement: updated.minBidIncrement,
        auctionStatus: "finalizing",
      });
    }
  }

  const pendingFinalizations = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.is_auction, true),
        eq(products.auction_status, "finalizing"),
        eq(products.auction_prize_assigned, false)
      )
    )
    .limit(100);

  for (const auction of pendingFinalizations) {
    const result = await db.transaction(async (tx) => {
      const lockedRows = await tx.execute(sql`
        select
          id,
          stock,
          price,
          sendable,
          auction_round,
          auction_status,
          auction_cooldown_seconds,
          min_bid_increment,
          current_bid
        from products
        where id = ${auction.id}
        for update
      `);

      const row = lockedRows.rows[0] as
        | {
            id: number;
            stock: number;
            price: number;
            sendable: boolean;
            auction_round: number;
            auction_status: string;
            auction_cooldown_seconds: number;
            min_bid_increment: number;
            current_bid: number;
          }
        | undefined;

      if (!row || row.auction_status !== "finalizing") return null;

      const topBidRows = await tx
        .select({
          user_id: product_bids.user_id,
          amount: product_bids.amount,
        })
        .from(product_bids)
        .where(
          and(
            eq(product_bids.product_id, row.id),
            eq(product_bids.auction_round, row.auction_round)
          )
        )
        .orderBy(desc(product_bids.amount), asc(product_bids.created_at))
        .limit(1);

      const topBid = topBidRows[0];

      let winningBid = row.current_bid;
      let winnerUserId: number | null = null;
      let winnerName: string | null = null;
      let winnerImage: string | null = null;
      let stockAfter = row.stock;

      if (topBid) {
        const bidderRows = await tx
          .select({
            id: users.id,
            username: users.username,
            image: users.image,
            total_points: users.total_points,
            used_points: users.used_points,
          })
          .from(users)
          .where(eq(users.id, topBid.user_id))
          .limit(1);

        const bidder = bidderRows[0];

        if (bidder) {
          const available = bidder.total_points - bidder.used_points;
          if (available >= topBid.amount && row.stock > 0) {
            await tx
              .update(users)
              .set({
                used_points: bidder.used_points + topBid.amount,
              })
              .where(eq(users.id, bidder.id));

            const orderStatus = row.sendable ? 1 : 0;

            await tx.insert(orders).values({
              user_id: bidder.id,
              product_id: row.id,
              status: orderStatus,
              total: topBid.amount,
              created_at: now,
            });

            stockAfter = Math.max(0, row.stock - 1);
            winningBid = topBid.amount;
            winnerUserId = bidder.id;
            winnerName = bidder.username;
            winnerImage = bidder.image;
          }
        }
      }

      const reopensAt = stockAfter > 0 ? now + row.auction_cooldown_seconds : null;

      await tx
        .update(products)
        .set({
          stock: stockAfter,
          current_bid: winningBid,
          current_bidder_user_id: winnerUserId,
          auction_status: "finalized",
          auction_prize_assigned: true,
          auction_reopens_at: reopensAt,
        })
        .where(eq(products.id, row.id));

      await tx
        .update(product_bids)
        .set({ status: "finalized" })
        .where(
          and(
            eq(product_bids.product_id, row.id),
            eq(product_bids.auction_round, row.auction_round)
          )
        );

      return {
        productId: row.id,
        winningBid,
        winnerUserId,
        winnerName,
        winnerImage,
        reopensAt,
        minBidIncrement: row.min_bid_increment,
      };
    });

    if (result) {
      finalized += 1;
      await publishBidUpdated({
        productId: result.productId,
        amount: result.winningBid,
        bidderId: result.winnerUserId,
        bidderName: result.winnerName,
        bidderImage: result.winnerImage,
        minBidIncrement: result.minBidIncrement,
        auctionStatus: "finalized",
        auctionReopensAt: result.reopensAt,
      });
    }
  }

  const readyToReopen = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.is_auction, true),
        eq(products.auction_status, "finalized"),
        lte(products.auction_reopens_at, now)
      )
    )
    .limit(100);

  for (const auction of readyToReopen) {
    const result = await db.transaction(async (tx) => {
      const lockedRows = await tx.execute(sql`
        select
          id,
          stock,
          price,
          auction_round,
          auction_duration_seconds,
          min_bid_increment,
          auction_status,
          auction_reopens_at
        from products
        where id = ${auction.id}
        for update
      `);

      const row = lockedRows.rows[0] as
        | {
            id: number;
            stock: number;
            price: number;
            auction_round: number;
            auction_duration_seconds: number;
            min_bid_increment: number;
            auction_status: string;
            auction_reopens_at: number | null;
          }
        | undefined;

      if (
        !row ||
        row.auction_status !== "finalized" ||
        !row.auction_reopens_at ||
        row.auction_reopens_at > now ||
        row.stock <= 0
      ) {
        return null;
      }

      const nextEndAt = now + Math.max(30, row.auction_duration_seconds);

      await tx
        .update(products)
        .set({
          auction_round: row.auction_round + 1,
          auction_status: "in_progress",
          auction_prize_assigned: false,
          auction_reopens_at: null,
          auction_ends_at: nextEndAt,
          current_bid: row.price,
          current_bidder_user_id: null,
        })
        .where(eq(products.id, row.id));

      return {
        productId: row.id,
        nextEndAt,
        amount: row.price,
        minBidIncrement: row.min_bid_increment,
      };
    });

    if (result) {
      reopened += 1;
      await publishBidUpdated({
        productId: result.productId,
        amount: result.amount,
        bidderId: null,
        bidderName: null,
        bidderImage: null,
        minBidIncrement: result.minBidIncrement,
        auctionStatus: "in_progress",
        auctionEndsAt: result.nextEndAt,
        auctionReopensAt: null,
      });
    }
  }

  return {
    movedToFinalizing,
    finalized,
    reopened,
  };
}
