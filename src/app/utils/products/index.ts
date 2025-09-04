"use server";

import { db } from "@/db/drizzle";
import { products } from "@/db/schema";
import { eq } from "drizzle-orm";

export const getProducts = async () => {
  const productsData = await db.select().from(products).limit(10000);

  return productsData;
};

export const createProduct = async (
  name: string,
  description: string,
  image: string,
  price: number,
  stock: number
) => {
  const created_at = Math.floor(Date.now() / 1000); // Current timestamp in seconds
  const newProduct = await db.insert(products).values({
    name,
    description,
    image,
    price,
    stock,
    created_at,
  });

  return newProduct;
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
    .where(eq(products.id, productId));
  return updatedProduct;
};

export const updateProduct = async (
  productId: number,
  updatedFields: Partial<{
    name: string;
    description: string;
    price: number;
    stock: number;
  }>
) => {
  const updatedProduct = await db
    .update(products)
    .set(updatedFields)
    .where(eq(products.id, productId));
  return updatedProduct;
};

export const getProductById = async (productId: number) => {
  const product = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1)
    .execute();

  return product[0];
};
