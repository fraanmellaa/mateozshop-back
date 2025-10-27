"use server";

import { db } from "@/db/drizzle";
import { orders, products, users } from "@/db/schema";
import { DecoratedOrder } from "./types";
import { eq } from "drizzle-orm";

export const getOrders = async () => {
  const ordersArray = await db
    .select({
      id: orders.id,
      status: orders.status,
      total: orders.total,
      created_at: orders.created_at,
      user: {
        id: users.id,
        username: users.username,
        email: users.email,
      },
      product: {
        id: products.id,
        name: products.name,
        image: products.image,
        price: products.price,
      },
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.user_id))
    .innerJoin(products, eq(products.id, orders.product_id));

  const decoratedOrders: Array<DecoratedOrder> = ordersArray.map((order) => ({
    id: order.id,
    username: order.user.username,
    product_name: order.product.name,
    product_image: order.product.image,
    status: order.status,
    total: order.total,
    created_at: new Date(order.created_at * 1000).toISOString(),
  }));

  return decoratedOrders;
};

export const getOrderById = async (orderId: number) => {
  const orderData = await db
    .select({
      id: orders.id,
      status: orders.status,
      total: orders.total,
      created_at: orders.created_at,
      user: {
        id: users.id,
        username: users.username,
        email: users.email,
        discord_id: users.discord_id,
        kick_id: users.kick_id,
        image: users.image,
        total_points: users.total_points,
        used_points: users.used_points,
      },
      product: {
        id: products.id,
        name: products.name,
        description: products.description,
        image: products.image,
        price: products.price,
        stock: products.stock,
        sendable: products.sendable,
      },
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.user_id))
    .innerJoin(products, eq(products.id, orders.product_id))
    .where(eq(orders.id, orderId))
    .execute();

  if (!orderData.length) {
    return null;
  }

  const order = orderData[0];

  return {
    id: order.id,
    status: order.status,
    total: order.total,
    created_at: new Date(order.created_at * 1000).toISOString(),
    user: {
      id: order.user.id,
      username: order.user.username,
      email: order.user.email,
      discord_id: order.user.discord_id,
      kick_id: order.user.kick_id,
      image: order.user.image,
      total_points: order.user.total_points,
      used_points: order.user.used_points,
      available_points: order.user.total_points - order.user.used_points,
    },
    product: {
      id: order.product.id,
      name: order.product.name,
      description: order.product.description,
      image: order.product.image,
      price: order.product.price,
      stock: order.product.stock,
      sendable: order.product.sendable,
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

  const newOrder = await db
    .insert(orders)
    .values({
      user_id,
      product_id,
      status,
      total,
      created_at: Math.floor(Date.now() / 1000), // Timestamp in seconds
    })
    .returning();

  return newOrder;
};

export const getUserOrders = async (userId: number) => {
  const ordersArray = await db
    .select({
      id: orders.id,
      status: orders.status,
      total: orders.total,
      created_at: orders.created_at,
      product: {
        id: products.id,
        name: products.name,
        image: products.image,
        price: products.price,
      },
    })
    .from(orders)
    .innerJoin(products, eq(products.id, orders.product_id))
    .where(eq(orders.user_id, userId));

  const decoratedOrders = ordersArray.map((order) => ({
    id: order.id,
    product_name: order.product.name,
    product_image: order.product.image,
    cost: order.product.price,
    status: order.status,
    created_at: new Date(order.created_at * 1000).toISOString(),
  }));

  return decoratedOrders;
};
