"use server";

import { createClient } from "@supabase/supabase-js";
import { DecoratedOrder } from "./types";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: "mateoz" },
  }
);

export const getOrders = async () => {
  const { data: ordersArray, error } = await supabase.from("orders").select(`
      id,
      status,
      total,
      created_at,
      user:users!orders_user_id_fkey(id, username, email),
      product:products!orders_product_id_fkey(id, name, image, price)
    `);

  if (error) {
    throw error;
  }

  const decoratedOrders: Array<DecoratedOrder> = ordersArray.map((order) => {
    const user = Array.isArray(order.user) ? order.user[0] : order.user;
    const product = Array.isArray(order.product) ? order.product[0] : order.product;

    return {
      id: order.id,
      username: user?.username ?? "",
      product_name: product?.name ?? "",
      product_image: product?.image ?? "",
      status: order.status,
      total: order.total,
      created_at: new Date(order.created_at * 1000).toISOString(),
    };
  });

  return decoratedOrders;
};

export const getOrderById = async (orderId: number) => {
  const { data: orderData, error } = await supabase
    .from("orders")
    .select(`
      id,
      status,
      total,
      created_at,
      user:users!orders_user_id_fkey(id, username, email, discord_id, kick_id, image, total_points, used_points),
      product:products!orders_product_id_fkey(id, name, description, image, price, stock, sendable)
    `)
    .eq("id", orderId)
    .limit(1);

  if (error) {
    throw error;
  }

  if (!orderData.length) {
    return null;
  }

  const order = orderData[0];
  const user = Array.isArray(order.user) ? order.user[0] : order.user;
  const product = Array.isArray(order.product) ? order.product[0] : order.product;

  return {
    id: order.id,
    status: order.status,
    total: order.total,
    created_at: new Date(order.created_at * 1000).toISOString(),
    user: {
      id: user?.id ?? 0,
      username: user?.username ?? "",
      email: user?.email ?? "",
      discord_id: user?.discord_id ?? "",
      kick_id: user?.kick_id ?? null,
      image: user?.image ?? "",
      total_points: user?.total_points ?? 0,
      used_points: user?.used_points ?? 0,
      available_points: (user?.total_points ?? 0) - (user?.used_points ?? 0),
    },
    product: {
      id: product?.id ?? 0,
      name: product?.name ?? "",
      description: product?.description ?? "",
      image: product?.image ?? "",
      price: product?.price ?? 0,
      stock: product?.stock ?? 0,
      sendable: product?.sendable ?? false,
    },
  };
};

export const createOrder = async (orderData: {
  user_id: number;
  product_id: number;
  status: number;
  total: number;
}) => {
  const { user_id, product_id, status, total } = orderData;

  const { data: newOrder, error } = await supabase
    .from("orders")
    .insert({
      user_id,
      product_id,
      status,
      total,
      created_at: Math.floor(Date.now() / 1000), // Timestamp in seconds
    })
    .select("*");

  if (error) {
    throw error;
  }

  return newOrder;
};

export const getUserOrders = async (userId: number) => {
  const { data: ordersArray, error } = await supabase
    .from("orders")
    .select(
      "id, status, total, created_at, product:products!orders_product_id_fkey(id, name, image, price)"
    )
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  const decoratedOrders = ordersArray.map((order) => {
    const product = Array.isArray(order.product) ? order.product[0] : order.product;

    return {
      id: order.id,
      product_name: product?.name ?? "",
      product_image: product?.image ?? "",
      cost: product?.price ?? 0,
      status: order.status,
      created_at: new Date(order.created_at * 1000).toISOString(),
    };
  });

  return decoratedOrders;
};
