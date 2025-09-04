import { getProducts } from "@/app/utils/products";
import { NextResponse } from "next/server";

export async function GET() {
  const products = await getProducts();

  const tempProducts = [];

  for (let i = 0; i < 28; i++) {
    tempProducts.push({
      ...products[0],
      id: i + 1,
    });
  }

  return NextResponse.json(
    {
      success: true,
      result: tempProducts ?? [],
    },
    {
      status: 200,
    }
  );
}
