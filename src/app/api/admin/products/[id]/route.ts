import { NextRequest, NextResponse } from "next/server";
import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { releaseAuctionHold } from "@/app/utils/points";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  updateProduct,
  deleteProduct,
  getProductById,
  ProductRow,
} from "@/app/utils/products";

/**
 * Cierra una subasta abierta a nuevas pujas (place_bid exige `in_progress` y el
 * cron ignora `cancelling`) para que nadie puje entre devolver la retención y
 * borrar o cambiar el producto.
 */
async function freezeAuction(id: number) {
  const { error } = await getSupabaseAdmin()
    .from("products")
    .update({ auction_status: "cancelling" })
    .eq("id", id)
    .eq("is_auction", true)
    .eq("auction_status", "in_progress");
  if (error) throw error;
}

async function unfreezeAuction(id: number) {
  await getSupabaseAdmin()
    .from("products")
    .update({ auction_status: "in_progress" })
    .eq("id", id)
    .eq("auction_status", "cancelling");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

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
  if (!(await requireAdmin())) return adminUnauthorized();

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
    const parsedAuctionEndsAt =
      auction_ends_at === undefined || auction_ends_at === null
        ? auction_ends_at
        : Number(auction_ends_at);

    if (
      typeof parsedAuctionEndsAt === "number" &&
      (!Number.isFinite(parsedAuctionEndsAt) || parsedAuctionEndsAt <= 0)
    ) {
      return NextResponse.json({ error: "Fecha límite inválida" }, { status: 400 });
    }

    if (
      codes !== undefined &&
      (!Array.isArray(codes) || codes.some((code) => typeof code !== "string"))
    ) {
      return NextResponse.json(
        { error: "Los códigos deben ser una lista de textos" },
        { status: 400 }
      );
    }

    if (parsedAuctionEndsAt !== undefined) {
      updateData.auction_ends_at =
        parsedAuctionEndsAt === null ? null : Math.floor(parsedAuctionEndsAt);
      if (parsedAuctionEndsAt !== null) {
        const now = Math.floor(Date.now() / 1000);
        updateData.auction_duration_seconds = Math.max(
          30,
          Math.floor(parsedAuctionEndsAt) - now
        );
      }
    }

    const nextIsAuction =
      is_auction !== undefined ? Boolean(is_auction) : existingProduct.is_auction;
    const becomesAuction = nextIsAuction && !existingProduct.is_auction;
    const leavesAuction = !nextIsAuction && existingProduct.is_auction;
    const nextAuctionEndsAt =
      updateData.auction_ends_at !== undefined
        ? updateData.auction_ends_at
        : existingProduct.auction_ends_at;
    const nextStock =
      parsedStock !== undefined ? Math.floor(parsedStock) : existingProduct.stock;
    const nextPrice =
      parsedPrice !== undefined ? Math.floor(parsedPrice) : existingProduct.price;

    // Las rondas ya cerradas (archivadas o en espera de reabrir) tienen stock 0
    // o no tienen fecha: esos requisitos solo aplican a una subasta abierta.
    const auctionOpen =
      nextIsAuction &&
      (becomesAuction || existingProduct.auction_status === "in_progress");

    if (auctionOpen && !nextAuctionEndsAt) {
      return NextResponse.json(
        { error: "Las subastas deben tener fecha límite" },
        { status: 400 }
      );
    }

    if (auctionOpen && nextStock < 1) {
      return NextResponse.json(
        { error: "Las subastas deben tener stock mínimo de 1" },
        { status: 400 }
      );
    }

    if (leavesAuction) {
      // Deja de ser subasta: se devuelve la retención al mejor postor.
      await freezeAuction(id);
      await releaseAuctionHold(id);
      updateData.current_bid = 0;
      updateData.current_bidder_user_id = null;
      updateData.auction_status = "in_progress";
      updateData.auction_prize_assigned = false;
      updateData.auction_reopens_at = null;
    } else if (becomesAuction) {
      // Empieza una subasta nueva, en una ronda propia y sin pujas.
      updateData.auction_status = "in_progress";
      updateData.auction_prize_assigned = false;
      updateData.auction_reopens_at = null;
      updateData.auction_starting_notified = false;
      updateData.auction_round = existingProduct.auction_round + 1;
      updateData.current_bid = nextPrice;
      updateData.current_bidder_user_id = null;
    } else if (
      nextIsAuction &&
      parsedPrice !== undefined &&
      !existingProduct.current_bidder_user_id &&
      !existingProduct.auction_prize_assigned
    ) {
      // Sin pujas, la puja actual es el precio de salida.
      updateData.current_bid = nextPrice;
    }

    if (sendable !== undefined) updateData.sendable = Boolean(sendable);
    if (codes !== undefined) updateData.codes = codes;
    if (used_codes !== undefined) updateData.used_codes = used_codes;

    let product;
    try {
      product = await updateProduct(id, updateData);
    } catch (updateError) {
      if (leavesAuction) await unfreezeAuction(id);
      throw updateError;
    }
    if (!product) {
      if (leavesAuction) await unfreezeAuction(id);
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );
    }

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
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (isNaN(id))
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    // Si es una subasta con pujas sin adjudicar, se devuelve la retención.
    await freezeAuction(id);
    await releaseAuctionHold(id);
    try {
      await deleteProduct(id);
    } catch (deleteError) {
      await unfreezeAuction(id);
      throw deleteError;
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting product:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
