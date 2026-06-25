import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: "mateoz" },
  }
);

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

    const { data: productRows, error: productError } = await supabase
      .from("products")
      .select("id, is_auction, auction_round")
      .eq("id", productId)
      .limit(1);

    if (productError) {
      throw productError;
    }

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

    const { data: bids, error: bidsError } = await supabase
      .from("product_bids")
      .select(
        "id, amount, created_at, status, user:users!product_bids_user_id_fkey(id, username, image)"
      )
      .eq("product_id", productId)
      .eq("auction_round", product.auction_round)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(5);

    if (bidsError) {
      throw bidsError;
    }

    const normalizedBids = (bids || []).map((bid) => {
      const user = Array.isArray(bid.user) ? bid.user[0] : bid.user;

      return {
        id: bid.id,
        amount: bid.amount,
        created_at: bid.created_at,
        status: bid.status,
        user_id: user?.id ?? null,
        username: user?.username ?? null,
        image: user?.image ?? null,
      };
    });

    return NextResponse.json(
      {
        success: true,
        data: normalizedBids,
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
