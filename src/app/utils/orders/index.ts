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
    status: order.status,
    total: order.total,
    created_at: new Date(order.created_at * 1000).toISOString(),
    product_name: order.product.name,
    product_image: order.product.image,
  }));

  return decoratedOrders;
};
