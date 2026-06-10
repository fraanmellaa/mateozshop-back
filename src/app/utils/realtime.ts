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
    at: Date.now(),
  };

  await ably.channels.get(`product-${payload.productId}`).publish("bid:updated", message);
  await ably.channels.get("auctions").publish("bid:updated", message);
}
