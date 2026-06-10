"use server";

import { db } from "@/db/drizzle";
import { products, users } from "@/db/schema";
import { and, eq, ne, or } from "drizzle-orm";

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

  const productsData = await db
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      image: products.image,
      price: products.price,
      stock: products.stock,
      is_auction: products.is_auction,
      min_bid_increment: products.min_bid_increment,
      auction_ends_at: products.auction_ends_at,
      auction_duration_seconds: products.auction_duration_seconds,
      auction_cooldown_seconds: products.auction_cooldown_seconds,
      auction_parent_product_id: products.auction_parent_product_id,
      auction_starting_notified: products.auction_starting_notified,
      auction_reopens_at: products.auction_reopens_at,
      auction_round: products.auction_round,
      auction_status: products.auction_status,
      auction_prize_assigned: products.auction_prize_assigned,
      current_bid: products.current_bid,
      current_bidder_user_id: products.current_bidder_user_id,
      current_bidder_username: users.username,
      current_bidder_image: users.image,
      codes: products.codes,
      used_codes: products.used_codes,
      sendable: products.sendable,
      created_at: products.created_at,
    })
    .from(products)
    .where(
      includeArchivedAuctions
        ? undefined
        : onlyActiveAuctions
          ? or(
              eq(products.is_auction, false),
              and(
                eq(products.is_auction, true),
                or(
                  eq(products.auction_status, "in_progress"),
                  eq(products.auction_status, "finalizing")
                )
              )
            )
          : or(
              eq(products.is_auction, false),
              and(eq(products.is_auction, true), ne(products.auction_status, "archived"))
            )
    )
    .leftJoin(users, eq(products.current_bidder_user_id, users.id))
    .limit(10000);

  // Normalize created_at to number if needed
  return productsData.map((p: ProductRow) => ({
    ...p,
    codes: p.codes || [],
    used_codes: p.used_codes || [],
    sendable: p.sendable || false,
  }));
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
  const created_at = Math.floor(Date.now() / 1000); // Current timestamp in seconds

  const result = await db
    .insert(products)
    .values({
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
    .returning();

  return result[0];
};

export const deleteProduct = async (productId: number) => {
  const deletedProduct = await db
    .delete(products)
    .where(eq(products.id, productId));
  return deletedProduct;
};

export const updateProductStock = async (
  productId: number,
  newStock: number
) => {
  const updatedProduct = await db
    .update(products)
    .set({ stock: newStock })
    .where(eq(products.id, productId))
    .returning();
  return updatedProduct[0];
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
  // If sendable set to false, clear codes/used_codes to avoid stale data
  const toUpdate: Partial<ProductRow> = { ...updatedFields };
  if (updatedFields.sendable === false) {
    toUpdate.codes = [];
    toUpdate.used_codes = [];
  }

  const updatedProduct = await db
    .update(products)
    .set(toUpdate)
    .where(eq(products.id, productId))
    .returning();
  return updatedProduct[0];
};

export const getProductById = async (productId: number) => {
  const product = await db
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      image: products.image,
      price: products.price,
      stock: products.stock,
      is_auction: products.is_auction,
      min_bid_increment: products.min_bid_increment,
      auction_ends_at: products.auction_ends_at,
      auction_duration_seconds: products.auction_duration_seconds,
      auction_cooldown_seconds: products.auction_cooldown_seconds,
      auction_parent_product_id: products.auction_parent_product_id,
      auction_starting_notified: products.auction_starting_notified,
      auction_reopens_at: products.auction_reopens_at,
      auction_round: products.auction_round,
      auction_status: products.auction_status,
      auction_prize_assigned: products.auction_prize_assigned,
      current_bid: products.current_bid,
      current_bidder_user_id: products.current_bidder_user_id,
      current_bidder_username: users.username,
      current_bidder_image: users.image,
      codes: products.codes,
      used_codes: products.used_codes,
      sendable: products.sendable,
      created_at: products.created_at,
    })
    .from(products)
    .leftJoin(users, eq(products.current_bidder_user_id, users.id))
    .where(eq(products.id, productId))
    .limit(1)
    .execute();

  const p = product[0] as ProductRow | undefined;
  if (!p) return null;

  return {
    ...p,
    codes: p.codes || [],
    used_codes: p.used_codes || [],
    sendable: p.sendable || false,
  };
};
