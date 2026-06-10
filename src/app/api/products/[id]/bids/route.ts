import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { product_bids, products, users } from "@/db/schema";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const productId = Number(id);

    if (!Number.isFinite(productId)) {
      return NextResponse.json(
        { success: false, error: "INVALID_PRODUCT_ID" },
        { status: 400 }
      );
    }

    const productRows = await db
      .select({
        id: products.id,
        is_auction: products.is_auction,
        auction_round: products.auction_round,
      })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    const product = productRows[0];

    if (!product) {
      return NextResponse.json(
        { success: false, error: "PRODUCT_NOT_FOUND" },
        { status: 404 }
      );
    }

    if (!product.is_auction) {
      return NextResponse.json(
        { success: false, error: "PRODUCT_NOT_AUCTION" },
        { status: 400 }
      );
    }

    const bids = await db
      .select({
        id: product_bids.id,
        amount: product_bids.amount,
        created_at: product_bids.created_at,
        status: product_bids.status,
        user_id: users.id,
        username: users.username,
        image: users.image,
      })
      .from(product_bids)
      .innerJoin(users, eq(users.id, product_bids.user_id))
      .where(
        and(
          eq(product_bids.product_id, productId),
          eq(product_bids.auction_round, product.auction_round)
        )
      )
      .orderBy(desc(product_bids.created_at), desc(product_bids.id))
      .limit(5);

    return NextResponse.json(
      {
        success: true,
        data: bids,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching product bids:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
