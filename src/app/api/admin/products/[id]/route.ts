import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { releaseAuctionHold } from "@/app/utils/points";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  deleteProduct,
  getProductById,
  productHasOrders,
  updateProduct,
} from "@/app/utils/products";
import {
  CATEGORY_MIGRATION_ERROR,
  PRODUCT_CATEGORY_KEYS,
  isMissingCategoryColumn,
} from "@/app/utils/products/categories";
import {
  AUCTION_RULES_MIGRATION_ERROR,
  PRODUCT_CURRENCY_KEYS,
  VIP_MIGRATION_ERROR,
  isMissingAuctionRulesColumn,
  isMissingColumn,
} from "@/app/utils/products/currency";

/**
 * Cierra la subasta a nuevas pujas (place_bid solo admite `waiting` e
 * `in_progress`; el cron ignora `cancelling`) para que nadie puje entre
 * devolver la retención y borrar el producto. Incluye `waiting`: una puja que
 * llegara justo ahora quedaría retenida sin subasta.
 */
async function freezeAuction(id: number) {
  const { error } = await getSupabaseAdmin()
    .from("products")
    .update({ auction_status: "cancelling" })
    .eq("id", id)
    .in("auction_status", ["waiting", "in_progress"]);
  if (error) throw error;
}

/**
 * Si el borrado falla, la subasta vuelve a abrirse: sin pujador y sin batalla
 * espera; sin pujador pero con batalla pasa a `finalizing` y el siguiente tick
 * la deja esperando (cancela las pujas de la ronda); con pujador sigue en batalla.
 */
async function unfreezeAuction(id: number) {
  const products = () => getSupabaseAdmin().from("products");
  await products()
    .update({ auction_status: "waiting" })
    .eq("id", id)
    .eq("auction_status", "cancelling")
    .is("current_bidder_user_id", null)
    .is("auction_ends_at", null);
  await products()
    .update({ auction_status: "finalizing" })
    .eq("id", id)
    .eq("auction_status", "cancelling")
    .is("current_bidder_user_id", null);
  await products()
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
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    const product = await getProductById(id);
    if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

    return NextResponse.json(product);
  } catch (error) {
    console.error("Error getting product:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// Solo estos campos se pueden editar: el estado de la puja (pujador, puja actual,
// cierre, ronda) lo gestionan place_bid y auction_settle, nunca el formulario.
const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  image: z.string().trim().url().max(2000).optional(),
  price: z.coerce.number().int().min(1).max(2_000_000_000).optional(),
  stock: z.coerce.number().int().min(0).max(100_000).optional(),
  value_eur: z
    .union([z.literal(""), z.null(), z.coerce.number().min(0).max(1_000_000)])
    .optional()
    .transform((v) => (v === "" ? null : v)),
  delivery_type: z.enum(["code", "trade", "dm"]).optional(),
  requires_trade_link: z.boolean().optional(),
  category: z
    .union([z.literal(""), z.null(), z.enum(PRODUCT_CATEGORY_KEYS)])
    .optional()
    .transform((v) => (v === "" ? null : v)),
  currency: z.enum(PRODUCT_CURRENCY_KEYS).optional(),
  // «Disponible desde» en segundos Unix; vacío, null o 0 = quitar la fecha.
  available_from: z
    .union([z.literal(""), z.null(), z.coerce.number().int().min(0).max(4_102_444_800)])
    .optional()
    .transform((v) => (v === "" || v === 0 ? null : v)),
  counts_for_cap: z.boolean().optional(),
  codes: z.array(z.string().trim().min(1).max(500)).max(10_000).optional(),
  /** Lista de códigos que veía el admin al abrir el formulario (para detectar entregas entre medias). */
  codes_before: z.array(z.string().trim().min(1).max(500)).max(10_000).optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    const existing = await getProductById(id);
    if (!existing) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
    }
    const body = parsed.data;

    const updateData: Parameters<typeof updateProduct>[1] = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.image !== undefined) updateData.image = body.image;
    // Cambiar el precio de salida no toca una puja ya abierta: place_bid solo lo
    // usa para la primera puja.
    if (body.price !== undefined) updateData.price = body.price;
    if (body.stock !== undefined) updateData.stock = body.stock;
    if (body.value_eur !== undefined) updateData.value_eur = body.value_eur;
    if (body.requires_trade_link !== undefined) updateData.requires_trade_link = body.requires_trade_link;
    if (body.codes !== undefined) {
      // Si desde que se abrió el formulario se ha entregado algún código, la
      // lista del admin está vieja: guardarla volvería a meter códigos ya
      // enviados y otro ganador recibiría uno repetido.
      const current = existing.codes ?? [];
      if (
        body.codes_before !== undefined &&
        (body.codes_before.length !== current.length || body.codes_before.some((code, i) => code !== current[i]))
      ) {
        return NextResponse.json(
          { error: "Los códigos han cambiado mientras editabas (se ha entregado alguno). Cierra, vuelve a abrir el premio y repite el cambio." },
          { status: 409 }
        );
      }
      updateData.codes = body.codes;
    }
    if (body.category !== undefined) updateData.category = body.category;
    // La fecha solo cuenta para ABRIR la puja: cambiarla no toca una ya abierta.
    if (body.available_from !== undefined) updateData.available_from = body.available_from;
    if (body.counts_for_cap !== undefined) updateData.counts_for_cap = body.counts_for_cap;

    // La moneda no se cambia con una puja en marcha: los puntos retenidos al
    // mejor postor se devolverían en la moneda equivocada.
    if (body.currency !== undefined && body.currency !== (existing.currency ?? "points")) {
      if (existing.auction_status !== "waiting" || existing.current_bidder_user_id !== null) {
        return NextResponse.json(
          { error: "No se puede cambiar la moneda de un premio con una puja en marcha" },
          { status: 409 }
        );
      }
      updateData.currency = body.currency;
    }
    if (body.delivery_type !== undefined) {
      updateData.delivery_type = body.delivery_type;
      updateData.sendable = body.delivery_type === "code";
      if (body.delivery_type === "trade") updateData.requires_trade_link = true;
    }

    // Una subasta archivada (sin stock) vuelve a esperar pujas si se repone stock.
    if (
      existing.auction_status === "archived" &&
      body.stock !== undefined &&
      body.stock > 0
    ) {
      updateData.auction_status = "waiting";
      updateData.auction_ends_at = null;
      updateData.auction_prize_assigned = false;
      updateData.current_bid = 0;
      updateData.current_bidder_user_id = null;
      updateData.auction_round = existing.auction_round + 1;
    }

    const product = await updateProduct(id, updateData);
    if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

    return NextResponse.json(product);
  } catch (error) {
    if (isMissingCategoryColumn(error)) {
      return NextResponse.json({ error: CATEGORY_MIGRATION_ERROR }, { status: 409 });
    }
    if (isMissingColumn(error, "currency")) {
      return NextResponse.json({ error: VIP_MIGRATION_ERROR }, { status: 409 });
    }
    if (isMissingAuctionRulesColumn(error)) {
      return NextResponse.json({ error: AUCTION_RULES_MIGRATION_ERROR }, { status: 409 });
    }
    console.error("Error updating product:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
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
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    // Borrarlo arrastraría el historial de pedidos: se deja sin stock en su lugar.
    if (await productHasOrders(id)) {
      return NextResponse.json(
        { error: "El producto tiene pedidos y no se puede borrar. Pon su stock a 0 para retirarlo." },
        { status: 409 }
      );
    }

    // Si hay una batalla con pujas, se devuelve la retención al mejor postor.
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
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
