import { createClient } from "@supabase/supabase-js";

import { publishBidUpdated, publishUserNotification } from "@/app/utils/realtime";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: "mateoz" },
  }
);

export async function processAuctionsTick() {
  const now = Math.floor(Date.now() / 1000);

  let movedToFinalizing = 0;
  let finalized = 0;
  let startingSoonNotified = 0;
  let reopened = 0;

  const { data: endedAuctions } = await supabase
    .from("products")
    .select("id, min_bid_increment")
    .eq("is_auction", true)
    .eq("auction_status", "in_progress")
    .lte("auction_ends_at", now)
    .limit(100);

  for (const auction of endedAuctions || []) {
    const { error } = await supabase
      .from("products")
      .update({ auction_status: "finalizing", auction_prize_assigned: false })
      .eq("id", auction.id)
      .eq("auction_status", "in_progress");

    if (!error) {
      await supabase
        .from("product_bids")
        .update({ status: "finalizing" })
        .eq("product_id", auction.id)
        .eq("status", "in_progress");

      movedToFinalizing += 1;
      await publishBidUpdated({
        productId: auction.id,
        amount: 0,
        minBidIncrement: auction.min_bid_increment,
        auctionStatus: "finalizing",
      });
    }
  }

  const { data: pendingFinalizations } = await supabase
    .from("products")
    .select("*")
    .eq("is_auction", true)
    .eq("auction_status", "finalizing")
    .eq("auction_prize_assigned", false)
    .limit(100);

  for (const auction of pendingFinalizations || []) {
    const { data: topBids } = await supabase
      .from("product_bids")
      .select("user_id, amount")
      .eq("product_id", auction.id)
      .eq("auction_round", auction.auction_round)
      .order("amount", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1);

    const topBid = topBids?.[0];

    let winningBid = auction.current_bid;
    let winnerUserId: number | null = null;
    let winnerName: string | null = null;
    let winnerImage: string | null = null;
    let winnerDiscordId: string | null = null;
    let stockAfter = auction.stock;

    if (topBid) {
      const { data: bidderRows } = await supabase
        .from("users")
        .select("id, username, image, discord_id, total_points, used_points")
        .eq("id", topBid.user_id)
        .limit(1);

      const bidder = bidderRows?.[0];

      if (bidder) {
        const available = bidder.total_points - bidder.used_points;
        if (available >= topBid.amount && auction.stock > 0) {
          await supabase
            .from("users")
            .update({ used_points: bidder.used_points + topBid.amount })
            .eq("id", bidder.id);

          await supabase.from("orders").insert({
            user_id: bidder.id,
            product_id: auction.id,
            status: auction.sendable ? 1 : 0,
            total: topBid.amount,
            created_at: now,
          });

          stockAfter = Math.max(0, auction.stock - 1);
          winningBid = topBid.amount;
          winnerUserId = bidder.id;
          winnerName = bidder.username;
          winnerImage = bidder.image;
          winnerDiscordId = bidder.discord_id;
        }
      }
    }

    let clonedProductId: number | null = null;
    let clonedProductName: string | null = null;
    let clonedProductImage: string | null = null;
    let clonedProductStock: number | null = null;
    let clonedProductAuctionStatus: string | null = null;
    let clonedProductAuctionReopensAt: number | null = null;

    const reopensAt = stockAfter > 0 ? now + auction.auction_cooldown_seconds : null;

    if (stockAfter > 0) {
      const { data: cloneRows } = await supabase
        .from("products")
        .insert({
          name: auction.name,
          description: auction.description,
          image: auction.image,
          price: auction.price,
          stock: stockAfter,
          is_auction: true,
          min_bid_increment: auction.min_bid_increment,
          auction_ends_at: null,
          auction_duration_seconds: auction.auction_duration_seconds,
          auction_cooldown_seconds: auction.auction_cooldown_seconds,
          auction_parent_product_id: auction.id,
          auction_starting_notified: false,
          auction_reopens_at: reopensAt,
          auction_round: 1,
          auction_status: "finalized",
          auction_prize_assigned: false,
          current_bid: auction.price,
          current_bidder_user_id: null,
          codes: auction.codes || [],
          used_codes: auction.used_codes || [],
          sendable: auction.sendable,
          created_at: now,
        })
        .select("id, name, image, stock, auction_status, auction_reopens_at");

      const cloned = cloneRows?.[0];
      if (cloned) {
        clonedProductId = cloned.id;
        clonedProductName = cloned.name;
        clonedProductImage = cloned.image;
        clonedProductStock = cloned.stock;
        clonedProductAuctionStatus = cloned.auction_status;
        clonedProductAuctionReopensAt = cloned.auction_reopens_at;
      }
    }

    await supabase
      .from("products")
      .update({
        stock: 0,
        current_bid: winningBid,
        current_bidder_user_id: winnerUserId,
        auction_status: stockAfter > 0 ? "archived" : "finalized",
        auction_prize_assigned: true,
        auction_reopens_at: null,
      })
      .eq("id", auction.id);

    await supabase
      .from("product_bids")
      .update({ status: "finalized" })
      .eq("product_id", auction.id)
      .eq("auction_round", auction.auction_round);

    finalized += 1;

    await publishBidUpdated({
      productId: auction.id,
      amount: winningBid,
      bidderId: winnerUserId,
      bidderName: winnerName,
      bidderImage: winnerImage,
      minBidIncrement: auction.min_bid_increment,
      auctionStatus: "finalized",
      auctionReopensAt: reopensAt,
      successorProductId: clonedProductId,
      successorName: clonedProductName,
      successorImage: clonedProductImage,
      successorPrice: auction.price,
      successorStock: clonedProductStock,
      successorAuctionStatus: clonedProductAuctionStatus,
      successorAuctionReopensAt: clonedProductAuctionReopensAt,
    });

    if (winnerDiscordId) {
      await publishUserNotification({
        discordId: winnerDiscordId,
        type: "auction_win",
        title: "Has ganado la puja",
        body: `Ganaste ${auction.name} por ${winningBid} puntos.`,
        productId: auction.id,
        productName: auction.name,
        productImage: auction.image,
        amount: winningBid,
        targetUrl: "/mi-cuenta/pedidos",
      });
    }

    if (clonedProductId) {
      await publishBidUpdated({
        productId: clonedProductId,
        amount: auction.price,
        bidderId: null,
        bidderName: null,
        bidderImage: null,
        minBidIncrement: auction.min_bid_increment,
        auctionStatus: "finalized",
        auctionReopensAt: reopensAt,
      });
    }
  }

  const { data: soonToStartAuctions } = await supabase
    .from("products")
    .select("id, name, image, price, auction_reopens_at")
    .eq("is_auction", true)
    .eq("auction_status", "finalized")
    .eq("auction_starting_notified", false)
    .gte("auction_reopens_at", now)
    .lte("auction_reopens_at", now + 300)
    .limit(100);

  for (const auction of soonToStartAuctions || []) {
    await supabase
      .from("products")
      .update({ auction_starting_notified: true })
      .eq("id", auction.id);

    startingSoonNotified += 1;
  }

  const { data: readyToReopen } = await supabase
    .from("products")
    .select("id, stock, price, auction_duration_seconds, min_bid_increment")
    .eq("is_auction", true)
    .eq("auction_status", "finalized")
    .gt("stock", 0)
    .lte("auction_reopens_at", now)
    .limit(100);

  for (const auction of readyToReopen || []) {
    const nextEndAt = now + Math.max(30, auction.auction_duration_seconds);

    const { error } = await supabase
      .from("products")
      .update({
        auction_status: "in_progress",
        auction_prize_assigned: false,
        auction_reopens_at: null,
        auction_ends_at: nextEndAt,
        current_bid: auction.price,
        current_bidder_user_id: null,
      })
      .eq("id", auction.id);

    if (!error) {
      reopened += 1;
      await publishBidUpdated({
        productId: auction.id,
        amount: auction.price,
        bidderId: null,
        bidderName: null,
        bidderImage: null,
        minBidIncrement: auction.min_bid_increment,
        auctionStatus: "in_progress",
        auctionEndsAt: nextEndAt,
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
