import { and, asc, desc, eq, gt, lte, sql } from "drizzle-orm";

import { publishBidUpdated, publishUserNotification } from "@/app/utils/realtime";
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
  let startingSoonNotified = 0;
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
          name,
          description,
          image,
          stock,
          price,
          sendable,
          auction_round,
          auction_status,
          auction_duration_seconds,
          auction_cooldown_seconds,
          auction_parent_product_id,
          min_bid_increment,
          current_bid,
          codes,
          used_codes
        from products
        where id = ${auction.id}
        for update
      `);

      const row = lockedRows.rows[0] as
        | {
            id: number;
            name: string;
            description: string;
            image: string;
            stock: number;
            price: number;
            sendable: boolean;
            auction_round: number;
            auction_status: string;
            auction_duration_seconds: number;
            auction_cooldown_seconds: number;
            auction_parent_product_id: number | null;
            min_bid_increment: number;
            current_bid: number;
            codes: string[];
            used_codes: string[];
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
      let winnerDiscordId: string | null = null;
      let stockAfter = row.stock;

      if (topBid) {
        const bidderRows = await tx
          .select({
            id: users.id,
            username: users.username,
            image: users.image,
            discord_id: users.discord_id,
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
            winnerDiscordId = bidder.discord_id;
          }
        }
      }

      const reopensAt = stockAfter > 0 ? now + row.auction_cooldown_seconds : null;

      let clonedProductId: number | null = null;
      let clonedProductName: string | null = null;
      let clonedProductImage: string | null = null;
      let clonedProductStock: number | null = null;
      let clonedProductAuctionStatus: string | null = null;
      let clonedProductAuctionReopensAt: number | null = null;

      if (stockAfter > 0) {
        const cloneRows = await tx
          .insert(products)
          .values({
            name: row.name,
            description: row.description,
            image: row.image,
            price: row.price,
            stock: stockAfter,
            is_auction: true,
            min_bid_increment: row.min_bid_increment,
            auction_ends_at: null,
            auction_duration_seconds: row.auction_duration_seconds,
            auction_cooldown_seconds: row.auction_cooldown_seconds,
            auction_parent_product_id: row.id,
            auction_starting_notified: false,
            auction_reopens_at: reopensAt,
            auction_round: 1,
            auction_status: "finalized",
            auction_prize_assigned: false,
            current_bid: row.price,
            current_bidder_user_id: null,
            codes: row.codes || [],
            used_codes: row.used_codes || [],
            sendable: row.sendable,
            created_at: now,
          })
          .returning({
            id: products.id,
            name: products.name,
            image: products.image,
            stock: products.stock,
            auction_status: products.auction_status,
            auction_reopens_at: products.auction_reopens_at,
          });

        clonedProductId = cloneRows[0]?.id ?? null;
        clonedProductName = cloneRows[0]?.name ?? null;
        clonedProductImage = cloneRows[0]?.image ?? null;
        clonedProductStock = cloneRows[0]?.stock ?? null;
        clonedProductAuctionStatus = cloneRows[0]?.auction_status ?? null;
        clonedProductAuctionReopensAt = cloneRows[0]?.auction_reopens_at ?? null;
      }

      await tx
        .update(products)
        .set({
          stock: 0,
          current_bid: winningBid,
          current_bidder_user_id: winnerUserId,
          auction_status: stockAfter > 0 ? "archived" : "finalized",
          auction_prize_assigned: true,
          auction_reopens_at: null,
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

      const participantRows = await tx.execute(sql`
        select distinct u.discord_id
        from product_bids pb
        inner join users u on u.id = pb.user_id
        where pb.product_id = ${row.id}
          and pb.auction_round = ${row.auction_round}
      `);

      const participantDiscordIds = participantRows.rows
        .map((entry) => (entry as { discord_id: string | null }).discord_id)
        .filter((discordId): discordId is string => Boolean(discordId));

      return {
        productId: row.id,
        productName: row.name,
        productImage: row.image,
        winningBid,
        winnerUserId,
        winnerName,
        winnerImage,
        winnerDiscordId,
        participantDiscordIds,
        reopensAt,
        minBidIncrement: row.min_bid_increment,
        clonedProductId,
        clonedProductName,
        clonedProductImage,
        clonedProductStock,
        clonedProductAuctionStatus,
        clonedProductAuctionReopensAt,
        nextPrice: row.price,
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
        successorProductId: result.clonedProductId,
        successorName: result.clonedProductName,
        successorImage: result.clonedProductImage,
        successorPrice: result.nextPrice,
        successorStock: result.clonedProductStock,
        successorAuctionStatus: result.clonedProductAuctionStatus,
        successorAuctionReopensAt: result.clonedProductAuctionReopensAt,
      });

      const targetProductId = result.clonedProductId ?? result.productId;

      if (result.winnerDiscordId) {
        await publishUserNotification({
          discordId: result.winnerDiscordId,
          type: "auction_win",
          title: "Has ganado la puja",
          body: `Ganaste ${result.productName} por ${result.winningBid} puntos.`,
          productId: result.productId,
          productName: result.productName,
          productImage: result.productImage,
          amount: result.winningBid,
          targetUrl: "/mi-cuenta/pedidos",
        });
      }

      const losingParticipants = result.participantDiscordIds.filter(
        (discordId) => discordId !== result.winnerDiscordId
      );

      for (const discordId of losingParticipants) {
        await publishUserNotification({
          discordId,
          type: "auction_finished",
          title: "La puja ha finalizado",
          body: `Finalizo la puja de ${result.productName}. Puedes revisar el estado actual.`,
          productId: targetProductId,
          productName: result.productName,
          productImage: result.productImage,
          amount: result.winningBid,
          targetUrl: `/puntos?auction=${targetProductId}&open=1`,
        });
      }

      if (result.clonedProductId) {
        await publishBidUpdated({
          productId: result.clonedProductId,
          amount: result.nextPrice,
          bidderId: null,
          bidderName: null,
          bidderImage: null,
          minBidIncrement: result.minBidIncrement,
          auctionStatus: "finalized",
          auctionReopensAt: result.reopensAt,
        });
      }
    }
  }

  const soonToStartAuctions = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.is_auction, true),
        eq(products.auction_status, "finalized"),
        lte(products.auction_reopens_at, now + 300),
        eq(products.auction_starting_notified, false)
      )
    )
    .limit(100);

  for (const auction of soonToStartAuctions) {
    const result = await db.transaction(async (tx) => {
      const lockedRows = await tx.execute(sql`
        select
          id,
          name,
          image,
          price,
          auction_status,
          auction_reopens_at,
          auction_parent_product_id,
          auction_starting_notified
        from products
        where id = ${auction.id}
        for update
      `);

      const row = lockedRows.rows[0] as
        | {
            id: number;
            name: string;
            image: string;
            price: number;
            auction_status: string;
            auction_reopens_at: number | null;
            auction_parent_product_id: number | null;
            auction_starting_notified: boolean;
          }
        | undefined;

      if (
        !row ||
        row.auction_status !== "finalized" ||
        !row.auction_reopens_at ||
        row.auction_reopens_at <= now ||
        row.auction_reopens_at > now + 300 ||
        row.auction_starting_notified
      ) {
        return null;
      }

      const participantRows = row.auction_parent_product_id
        ? await tx.execute(sql`
            select distinct u.discord_id
            from product_bids pb
            inner join users u on u.id = pb.user_id
            where pb.product_id = ${row.auction_parent_product_id}
          `)
        : { rows: [] as Array<{ discord_id: string | null }> };

      const participantDiscordIds = participantRows.rows
        .map((entry) => (entry as { discord_id: string | null }).discord_id)
        .filter((discordId): discordId is string => Boolean(discordId));

      await tx
        .update(products)
        .set({ auction_starting_notified: true })
        .where(eq(products.id, row.id));

      return {
        productId: row.id,
        productName: row.name,
        productImage: row.image,
        initialPrice: row.price,
        participantDiscordIds,
      };
    });

    if (result) {
      startingSoonNotified += result.participantDiscordIds.length;

      for (const discordId of result.participantDiscordIds) {
        await publishUserNotification({
          discordId,
          type: "auction_starting",
          title: "Puja a punto de empezar",
          body: `${result.productName} comienza en menos de 5 minutos desde ${result.initialPrice} puntos.`,
          productId: result.productId,
          productName: result.productName,
          productImage: result.productImage,
          initialPrice: result.initialPrice,
          targetUrl: `/puntos?auction=${result.productId}&open=1`,
        });
      }
    }
  }

  const readyToReopen = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.is_auction, true),
        eq(products.auction_status, "finalized"),
        gt(products.stock, 0),
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
    startingSoonNotified,
    reopened,
  };
}
