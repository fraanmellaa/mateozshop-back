"use server";

import { db } from "@/db/drizzle";
import { products } from "@/db/schema";
import { eq } from "drizzle-orm";

export type ProductRow = {
  id: number;
  name: string;
  description: string;
  image: string;
  price: number;
  stock: number;
  codes: string[];
  used_codes: string[];
  sendable: boolean;
  created_at: number;
};

export const getProducts = async (): Promise<ProductRow[]> => {
  const productsData = await db.select().from(products).limit(10000);

  // Normalize created_at to number if needed
  return productsData.map((p: any) => ({
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
    sendable: boolean;
    codes: string[];
    used_codes: string[];
  }>
) => {
  // If sendable set to false, clear codes/used_codes to avoid stale data
  const toUpdate: any = { ...updatedFields };
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
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1)
    .execute();

  const p = product[0] as any;
  if (!p) return null;

  return {
    ...p,
    codes: p.codes || [],
    used_codes: p.used_codes || [],
    sendable: p.sendable || false,
  };
};
