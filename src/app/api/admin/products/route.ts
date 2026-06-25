import { NextRequest, NextResponse } from "next/server";
import { getProducts, createProduct } from "@/app/utils/products";

export async function GET() {
  try {
    const products = await getProducts();
    return NextResponse.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      description,
      image,
      price,
      stock,
      sendable,
      codes,
      is_auction,
      min_bid_increment,
      auction_ends_at,
      auction_cooldown_seconds,
    } = body;

    if (
      !name ||
      !description ||
      !image ||
      price === undefined ||
      stock === undefined
    ) {
      return NextResponse.json(
        { error: "Todos los campos son requeridos" },
        { status: 400 }
      );
    }

    if (sendable && (!codes || !Array.isArray(codes))) {
      return NextResponse.json(
        { error: "Si el producto es enviable, los códigos deben ser un array" },
        { status: 400 }
      );
    }

    if (Boolean(is_auction) && !auction_ends_at) {
      return NextResponse.json(
        { error: "Las subastas deben tener fecha límite" },
        { status: 400 }
      );
    }

    const parsedPrice = Number(price);
    const parsedStock = Number(stock);
    const parsedMinBidIncrement = Number(min_bid_increment ?? 1);
    const parsedAuctionCooldownSeconds = Number(auction_cooldown_seconds ?? 300);

    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      return NextResponse.json(
        { error: "Precio inválido" },
        { status: 400 }
      );
    }

    if (!Number.isFinite(parsedStock) || parsedStock < 0) {
      return NextResponse.json(
        { error: "Stock inválido" },
        { status: 400 }
      );
    }

    if (Boolean(is_auction) && parsedStock < 1) {
      return NextResponse.json(
        { error: "Las subastas deben crearse con stock mínimo de 1" },
        { status: 400 }
      );
    }

    if (!Number.isFinite(parsedMinBidIncrement) || parsedMinBidIncrement < 1) {
      return NextResponse.json(
        { error: "Incremento mínimo inválido" },
        { status: 400 }
      );
    }

    if (
      !Number.isFinite(parsedAuctionCooldownSeconds) ||
      parsedAuctionCooldownSeconds < 10
    ) {
      return NextResponse.json(
        { error: "Cooldown inválido" },
        { status: 400 }
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const parsedAuctionEndsAt =
      auction_ends_at === null || auction_ends_at === undefined
        ? null
        : parseInt(auction_ends_at);
    const auctionDurationSeconds = parsedAuctionEndsAt
      ? Math.max(30, parsedAuctionEndsAt - now)
      : 3600;

    const product = await createProduct({
      name,
      description,
      image,
      price: Math.floor(parsedPrice),
      stock: Math.floor(parsedStock),
      is_auction: Boolean(is_auction),
      min_bid_increment: Math.max(1, Math.floor(parsedMinBidIncrement)),
      auction_ends_at: parsedAuctionEndsAt,
      auction_duration_seconds: auctionDurationSeconds,
      auction_cooldown_seconds: Math.max(
        10,
        Math.floor(parsedAuctionCooldownSeconds)
      ),
      sendable: Boolean(sendable),
      codes: codes || [],
    });

    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "AUCTION_REQUIRES_STOCK"
    ) {
      return NextResponse.json(
        { error: "Las subastas deben tener stock mínimo de 1" },
        { status: 400 }
      );
    }

    console.error("Error creating product:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
