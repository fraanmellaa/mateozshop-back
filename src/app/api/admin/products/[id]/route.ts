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

    const updateData: Partial<ProductRow> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (image !== undefined) updateData.image = image;
    if (price !== undefined) updateData.price = parseInt(price);
    if (stock !== undefined) updateData.stock = parseInt(stock);
    if (is_auction !== undefined) updateData.is_auction = Boolean(is_auction);
    if (min_bid_increment !== undefined) {
      updateData.min_bid_increment = Math.max(1, parseInt(min_bid_increment));
    }
    if (auction_cooldown_seconds !== undefined) {
      updateData.auction_cooldown_seconds = Math.max(
        10,
        parseInt(auction_cooldown_seconds)
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

    if (nextIsAuction && !nextAuctionEndsAt) {
      return NextResponse.json(
        { error: "Las subastas deben tener fecha límite" },
        { status: 400 }
      );
    }

    if (is_auction === true) {
      const basePrice =
        price !== undefined
          ? parseInt(price)
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
