import { getProducts } from "@/app/utils/products";
import { NextResponse } from "next/server";

export async function GET() {
  const products = await getProducts();

  return NextResponse.json(
    {
      success: true,
      result: products,
    },
    {
      status: 200,
    }
  );
}
