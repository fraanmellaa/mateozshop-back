import * as Ably from "ably";

let _ably: Ably.Rest | null = null;

function getAbly(): Ably.Rest | null {
  if (_ably) return _ably;

  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) return null;

  _ably = new Ably.Rest(apiKey);
  return _ably;
}

export async function publishBidUpdated(payload: {
  productId: number;
  amount: number;
  bidderName?: string | null;
  bidderImage?: string | null;
  bidderId?: number | null;
  minBidIncrement: number;
  auctionStatus?: string;
  auctionEndsAt?: number | null;
  auctionReopensAt?: number | null;
  successorProductId?: number | null;
  successorName?: string | null;
  successorImage?: string | null;
  successorPrice?: number | null;
  successorStock?: number | null;
  successorAuctionStatus?: string | null;
  successorAuctionReopensAt?: number | null;
}) {
  const ably = getAbly();
  if (!ably) return;

  const message = {
    productId: payload.productId,
    amount: payload.amount,
    bidderName: payload.bidderName,
    bidderImage: payload.bidderImage,
    bidderId: payload.bidderId,
    minBidIncrement: payload.minBidIncrement,
    auctionStatus: payload.auctionStatus,
    auctionEndsAt: payload.auctionEndsAt,
    auctionReopensAt: payload.auctionReopensAt,
    successorProductId: payload.successorProductId,
    successorName: payload.successorName,
    successorImage: payload.successorImage,
    successorPrice: payload.successorPrice,
    successorStock: payload.successorStock,
    successorAuctionStatus: payload.successorAuctionStatus,
    successorAuctionReopensAt: payload.successorAuctionReopensAt,
    at: Date.now(),
  };

  await ably.channels.get(`product-${payload.productId}`).publish("bid:updated", message);
  await ably.channels.get("auctions").publish("bid:updated", message);
}

export async function publishUserNotification(payload: {
  discordId: string;
  type:
    | "auction_win"
    | "auction_outbid"
    | "auction_finished"
    | "auction_starting"
    | "giveaway_finished"
    | "giveaway_won";
  title: string;
  body: string;
  productId?: number;
  productName?: string;
  productImage?: string;
  giveawayId?: number;
  giveawayTitle?: string;
  giveawayImage?: string;
  amount?: number;
  initialPrice?: number;
  targetUrl: string;
}) {
  const ably = getAbly();
  if (!ably) return;

  await ably
    .channels
    .get(`user-${payload.discordId}`)
    .publish("notify", {
      ...payload,
      at: Date.now(),
    });
}
