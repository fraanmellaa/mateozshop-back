"use server";

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: "mateoz" },
  }
);

export type ProductRow = {
  id: number;
  name: string;
  description: string;
  image: string;
  price: number;
  stock: number;
  is_auction: boolean;
  min_bid_increment: number;
  auction_ends_at: number | null;
  auction_duration_seconds: number;
  auction_cooldown_seconds: number;
  auction_parent_product_id: number | null;
  auction_starting_notified: boolean;
  auction_reopens_at: number | null;
  auction_round: number;
  auction_status: string;
  auction_prize_assigned: boolean;
  current_bid: number;
  current_bidder_user_id: number | null;
  current_bidder_username?: string | null;
  current_bidder_image?: string | null;
  codes: string[];
  used_codes: string[];
  sendable: boolean;
  created_at: number;
};

export const getProducts = async (
  options?: {
    includeArchivedAuctions?: boolean;
    onlyActiveAuctions?: boolean;
  }
): Promise<ProductRow[]> => {
  const includeArchivedAuctions = options?.includeArchivedAuctions ?? false;
  const onlyActiveAuctions = options?.onlyActiveAuctions ?? false;

  const { data, error } = await supabase.from("products").select(`
      *,
      bidder:users!products_current_bidder_user_id_fkey(username, image)
    `);

  if (error) {
    throw error;
  }

  let rows = (data || []).map((p) => ({
    ...p,
    current_bidder_username: p.bidder?.username ?? null,
    current_bidder_image: p.bidder?.image ?? null,
    codes: p.codes || [],
    used_codes: p.used_codes || [],
    sendable: Boolean(p.sendable),
  }));

  if (!includeArchivedAuctions) {
    if (onlyActiveAuctions) {
      rows = rows.filter(
        (p) =>
          !p.is_auction ||
          (p.is_auction && (p.auction_status === "in_progress" || p.auction_status === "finalizing"))
      );
    } else {
      rows = rows.filter((p) => !p.is_auction || p.auction_status !== "archived");
    }
  }

  return rows;
};

export const createProduct = async (data: {
  name: string;
  description: string;
  image: string;
  price: number;
  stock: number;
  is_auction?: boolean;
  min_bid_increment?: number;
  auction_ends_at?: number | null;
  auction_duration_seconds?: number;
  auction_cooldown_seconds?: number;
  auction_parent_product_id?: number | null;
  sendable?: boolean;
  codes?: string[];
}) => {
  if (Boolean(data.is_auction) && data.stock < 1) {
    throw new Error("AUCTION_REQUIRES_STOCK");
  }

  const created_at = Math.floor(Date.now() / 1000);

  const { data: result, error } = await supabase
    .from("products")
    .insert({
      name: data.name,
      description: data.description,
      image: data.image,
      price: data.price,
      stock: data.stock,
      is_auction: data.is_auction ?? false,
      min_bid_increment: data.min_bid_increment ?? 1,
      auction_ends_at: data.auction_ends_at ?? null,
      auction_duration_seconds: data.auction_duration_seconds ?? 3600,
      auction_cooldown_seconds: data.auction_cooldown_seconds ?? 300,
      auction_parent_product_id: data.auction_parent_product_id ?? null,
      auction_starting_notified: false,
      auction_reopens_at: null,
      auction_round: 1,
      auction_status: "in_progress",
      auction_prize_assigned: false,
      current_bid: data.is_auction ? data.price : 0,
      current_bidder_user_id: null,
      sendable: data.sendable ?? false,
      codes: data.sendable ? data.codes || [] : [],
      used_codes: [],
      created_at,
    })
    .select("*");

  if (error) {
    throw error;
  }

  return result?.[0];
};

export const deleteProduct = async (productId: number) => {
  const { error } = await supabase.from("products").delete().eq("id", productId);
  if (error) {
    throw error;
  }
  return true;
};

export const updateProductStock = async (productId: number, newStock: number) => {
  const { data, error } = await supabase
    .from("products")
    .update({ stock: newStock })
    .eq("id", productId)
    .select("*");

  if (error) {
    throw error;
  }

  return data?.[0];
};

export const updateProduct = async (
  productId: number,
  updatedFields: Partial<{
    name: string;
    description: string;
    price: number;
    stock: number;
    is_auction: boolean;
    min_bid_increment: number;
    auction_ends_at: number | null;
    auction_duration_seconds: number;
    auction_cooldown_seconds: number;
    auction_parent_product_id: number | null;
    auction_starting_notified: boolean;
    auction_reopens_at: number | null;
    auction_round: number;
    auction_status: string;
    auction_prize_assigned: boolean;
    current_bid: number;
    current_bidder_user_id: number | null;
    sendable: boolean;
    codes: string[];
    used_codes: string[];
  }>
) => {
  const { data: existingRows, error: existingError } = await supabase
    .from("products")
    .select("stock, is_auction, auction_status")
    .eq("id", productId)
    .limit(1);

  if (existingError) {
    throw existingError;
  }

  const existing = existingRows?.[0];
  if (!existing) {
    return undefined;
  }

  const toUpdate: Record<string, unknown> = { ...updatedFields };
  if (updatedFields.sendable === false) {
    toUpdate.codes = [];
    toUpdate.used_codes = [];
  }

  const nextIsAuction = updatedFields.is_auction ?? existing.is_auction;
  const nextStatus = updatedFields.auction_status ?? existing.auction_status;
  const nextStock = updatedFields.stock ?? existing.stock;

  if (nextIsAuction && nextStock < 1) {
    throw new Error("AUCTION_REQUIRES_STOCK");
  }

  if (nextStatus === "in_progress" && nextStock < 1) {
    throw new Error("AUCTION_REQUIRES_STOCK");
  }

  const { data, error } = await supabase
    .from("products")
    .update(toUpdate)
    .eq("id", productId)
    .select("*");

  if (error) {
    throw error;
  }

  return data?.[0];
};

export const getProductById = async (productId: number) => {
  const { data, error } = await supabase
    .from("products")
    .select("*, bidder:users!products_current_bidder_user_id_fkey(username, image)")
    .eq("id", productId)
    .limit(1);

  if (error) {
    throw error;
  }

  const p = data?.[0];
  if (!p) return null;

  return {
    ...p,
    current_bidder_username: p.bidder?.username ?? null,
    current_bidder_image: p.bidder?.image ?? null,
    codes: p.codes || [],
    used_codes: p.used_codes || [],
    sendable: p.sendable || false,
  };
};
