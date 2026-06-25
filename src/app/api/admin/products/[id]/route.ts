import { NextRequest, NextResponse } from "next/server";
import {
  updateProduct,
  deleteProduct,
  getProductById,
  ProductRow,
} from "@/app/utils/products";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (isNaN(id))
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    const product = await getProductById(id);
    if (!product)
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );

    return NextResponse.json(product);
  } catch (error) {
    console.error("Error getting product:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (isNaN(id))
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    const body = await request.json();
    const existingProduct = await getProductById(id);
    if (!existingProduct)
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );

    const {
      name,
      description,
      image,
      price,
      stock,
      is_auction,
      min_bid_increment,
      auction_ends_at,
      auction_cooldown_seconds,
      sendable,
      codes,
      used_codes,
    } = body;

    const parsedPrice = price !== undefined ? Number(price) : undefined;
    const parsedStock = stock !== undefined ? Number(stock) : undefined;
    const parsedMinBidIncrement =
      min_bid_increment !== undefined ? Number(min_bid_increment) : undefined;
    const parsedAuctionCooldownSeconds =
      auction_cooldown_seconds !== undefined
        ? Number(auction_cooldown_seconds)
        : undefined;

    if (
      parsedPrice !== undefined &&
      (!Number.isFinite(parsedPrice) || parsedPrice < 0)
    ) {
      return NextResponse.json({ error: "Precio inválido" }, { status: 400 });
    }

    if (
      parsedStock !== undefined &&
      (!Number.isFinite(parsedStock) || parsedStock < 0)
    ) {
      return NextResponse.json({ error: "Stock inválido" }, { status: 400 });
    }

    if (
      parsedMinBidIncrement !== undefined &&
      (!Number.isFinite(parsedMinBidIncrement) || parsedMinBidIncrement < 1)
    ) {
      return NextResponse.json(
        { error: "Incremento mínimo inválido" },
        { status: 400 }
      );
    }

    if (
      parsedAuctionCooldownSeconds !== undefined &&
      (!Number.isFinite(parsedAuctionCooldownSeconds) ||
        parsedAuctionCooldownSeconds < 10)
    ) {
      return NextResponse.json({ error: "Cooldown inválido" }, { status: 400 });
    }

    const updateData: Partial<ProductRow> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (image !== undefined) updateData.image = image;
    if (parsedPrice !== undefined) updateData.price = Math.floor(parsedPrice);
    if (parsedStock !== undefined) updateData.stock = Math.floor(parsedStock);
    if (is_auction !== undefined) updateData.is_auction = Boolean(is_auction);
    if (parsedMinBidIncrement !== undefined) {
      updateData.min_bid_increment = Math.max(
        1,
        Math.floor(parsedMinBidIncrement)
      );
    }
    if (parsedAuctionCooldownSeconds !== undefined) {
      updateData.auction_cooldown_seconds = Math.max(
        10,
        Math.floor(parsedAuctionCooldownSeconds)
      );
    }
    if (auction_ends_at !== undefined) {
      updateData.auction_ends_at =
        auction_ends_at === null ? null : parseInt(auction_ends_at);
      if (auction_ends_at !== null) {
        const now = Math.floor(Date.now() / 1000);
        updateData.auction_duration_seconds = Math.max(
          30,
          parseInt(auction_ends_at) - now
        );
      }
    }

    const nextIsAuction =
      is_auction !== undefined ? Boolean(is_auction) : existingProduct.is_auction;
    const nextAuctionEndsAt =
      auction_ends_at !== undefined
        ? auction_ends_at === null
          ? null
          : parseInt(auction_ends_at)
        : existingProduct.auction_ends_at;
    const nextStock =
      parsedStock !== undefined ? Math.floor(parsedStock) : existingProduct.stock;

    if (nextIsAuction && !nextAuctionEndsAt) {
      return NextResponse.json(
        { error: "Las subastas deben tener fecha límite" },
        { status: 400 }
      );
    }

    if (nextIsAuction && nextStock < 1) {
      return NextResponse.json(
        { error: "Las subastas deben tener stock mínimo de 1" },
        { status: 400 }
      );
    }

    if (is_auction === true) {
      const basePrice =
        parsedPrice !== undefined
          ? Math.floor(parsedPrice)
          : existingProduct.price;
      updateData.current_bid =
        existingProduct.current_bid > 0
          ? existingProduct.current_bid
          : basePrice;
    }
    if (sendable !== undefined) updateData.sendable = Boolean(sendable);
    if (codes !== undefined) updateData.codes = codes;
    if (used_codes !== undefined) updateData.used_codes = used_codes;

    const product = await updateProduct(id, updateData);
    if (!product)
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );

    return NextResponse.json(product);
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

    console.error("Error updating product:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (isNaN(id))
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    await deleteProduct(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting product:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
