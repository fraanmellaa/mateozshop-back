"use server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/app/utils/auth";
import { refundPoints } from "@/app/utils/points";
import { getOrderCurrency, refundVip } from "@/app/utils/points/vip";
import { isHoldVoided } from "@/app/utils/shop/bids";
import { sendCustomEmail, sendEmail } from "../email";
import { passOrderToNextCore, reviewOrderCore } from "./review";

const UNAUTHORIZED = { success: false as const, error: "Sesión de administrador no válida" };

const ORDER_STATUSES = [0, 1, 2];
const CANCELLED = 2;

/** Devuelve una unidad al stock sin pisar cambios concurrentes. */
async function restockProduct(productId: number) {
  const supabase = getSupabaseAdmin();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: rows, error } = await supabase
      .from("products")
      .select("stock, is_auction, sendable")
      .eq("id", productId)
      .limit(1);
    if (error) throw error;

    const product = rows?.[0];
    // Las subastas llevan su stock en la fila de la ronda siguiente, y un
    // producto con códigos ya gastó uno: en ambos casos no hay unidad que devolver.
    if (!product || product.is_auction || product.sendable) return;

    const { data: updated, error: updateError } = await supabase
      .from("products")
      .update({ stock: product.stock + 1 })
      .eq("id", productId)
      .eq("stock", product.stock)
      .select("id");
    if (updateError) throw updateError;
    if (updated?.length) return;
  }

  throw new Error("RESTOCK_CONFLICT");
}

export async function updateOrderStatus(orderId: number, status: number) {
  if (!(await requireAdmin())) return UNAUTHORIZED;

  if (!Number.isInteger(orderId) || !ORDER_STATUSES.includes(status)) {
    return { success: false, error: "Estado de pedido no válido" };
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: rows, error: readError } = await supabase
      .from("orders")
      .select("id, status, user_id, product_id, total, delivered_code, needs_review, reviewed_at, created_at")
      .eq("id", orderId)
      .limit(1);
    if (readError) throw readError;

    const order = rows?.[0];
    if (!order) {
      return { success: false, error: "Pedido no encontrado" };
    }

    if (order.status === CANCELLED) {
      // Los puntos ya se devolvieron: reabrirlo regalaría el producto.
      return status === CANCELLED
        ? { success: true }
        : { success: false, error: "Un pedido cancelado no se puede reabrir" };
    }

    // Un premio que requiere revisión se resuelve con Aprobar/Rechazar (que además
    // devuelve el código reservado al almacén): no se completa ni se cancela a mano.
    if (order.needs_review && !order.reviewed_at) {
      return { success: false, error: "El pedido está pendiente de revisión: apruébalo o recházalo primero" };
    }

    if (status === CANCELLED) {
      // La devolución va primero y lleva clave de idempotencia: si algo falla
      // después, repetir la cancelación no devuelve los puntos dos veces.
      // Un premio pujado con puntos VIP se devuelve en puntos VIP. Si el pedido es
      // de antes de un reinicio de saldos, esos puntos ya no existen: no se devuelven.
      const currency = await getOrderCurrency(order.id);
      if (order.total > 0 && !(await isHoldVoided(order.created_at, currency))) {
        const refund = currency === "vip" ? refundVip : refundPoints;
        await refund(order.user_id, order.total, {
          kind: "order_refund",
          refType: "order",
          refId: order.id,
          idempotencyKey: `order:${order.id}:refund`,
        });
      }

      const { data: cancelled, error: cancelError } = await supabase
        .from("orders")
        .update({ status: CANCELLED })
        .eq("id", orderId)
        .neq("status", CANCELLED)
        .select("id");
      if (cancelError) throw cancelError;

      // Solo quien hace la transición repone stock, y solo si no se entregó código.
      if (cancelled?.length && !order.delivered_code) {
        try {
          await restockProduct(order.product_id);
        } catch (error) {
          console.error(`Order ${orderId}: cancelled but stock not restored`, error);
          return {
            success: true,
            warning: "Pedido cancelado y puntos devueltos, pero no se pudo reponer el stock",
          };
        }
      }

      return { success: true };
    }

    const { data: updated, error } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", orderId)
      .neq("status", CANCELLED)
      .select("id");
    if (error) throw error;

    if (!updated?.length) {
      return { success: false, error: "Un pedido cancelado no se puede reabrir" };
    }

    return { success: true };
  } catch (error) {
    console.error("Error updating order status:", error);
    return {
      success: false,
      error: "Error al actualizar el estado del pedido",
    };
  }
}

async function getOrderRecipient(orderId: number) {
  const { data: rows, error } = await getSupabaseAdmin()
    .from("orders")
    .select("id, status, delivered_code, needs_review, reviewed_at, user:users!orders_user_id_fkey(email)")
    .eq("id", orderId)
    .limit(1);
  if (error) throw error;

  const order = rows?.[0];
  if (!order) return null;

  const user = Array.isArray(order.user) ? order.user[0] : order.user;
  return {
    email: (user?.email as string | undefined) || null,
    deliveredCode: (order.delivered_code as string | null) ?? null,
    status: order.status as number,
    pendingReview: Boolean(order.needs_review) && !order.reviewed_at,
  };
}

/** Email libre al usuario del pedido. El destinatario lo resuelve el servidor. */
export async function sendOrderEmail(orderId: number, subject: string, message: string) {
  if (!(await requireAdmin())) return UNAUTHORIZED;

  if (
    !Number.isInteger(orderId) ||
    typeof subject !== "string" ||
    typeof message !== "string" ||
    !subject.trim() ||
    !message.trim()
  ) {
    return { success: false, error: "Asunto y mensaje son obligatorios" };
  }

  try {
    const recipient = await getOrderRecipient(orderId);
    if (!recipient) return { success: false, error: "Pedido no encontrado" };
    if (!recipient.email) return { success: false, error: "El usuario no tiene email" };

    const success = await sendCustomEmail(recipient.email, subject, message);

    if (!success) {
      return { success: false, error: "Error al enviar el email" };
    }

    return { success: true };
  } catch (error) {
    console.error("Error sending order email:", error);
    return { success: false, error: "Error al enviar el email" };
  }
}

/** Reenvía al usuario el código entregado con el pedido. */
export async function resendOrderCode(orderId: number) {
  if (!(await requireAdmin())) return UNAUTHORIZED;

  if (!Number.isInteger(orderId)) {
    return { success: false, error: "Pedido no válido" };
  }

  try {
    const recipient = await getOrderRecipient(orderId);
    if (!recipient) return { success: false, error: "Pedido no encontrado" };
    if (!recipient.deliveredCode) return { success: false, error: "Este pedido no lleva código" };
    if (recipient.status === 2) return { success: false, error: "El pedido está cancelado" };
    if (recipient.pendingReview) {
      return { success: false, error: "El pedido está pendiente de revisión: no se puede enviar el código todavía" };
    }
    if (!recipient.email) return { success: false, error: "El usuario no tiene email" };

    const sent = await sendEmail(recipient.email, "PRODUCT_WITH_REWARD", recipient.deliveredCode);

    const { error } = await getSupabaseAdmin()
      .from("orders")
      // Si el código acaba de llegar, el pedido queda entregado.
      .update(sent && recipient.status === 0 ? { code_email_sent: true, status: 1 } : { code_email_sent: sent })
      .eq("id", orderId)
      .neq("status", CANCELLED);
    if (error) console.error(`Order ${orderId}: could not store email result`, error);

    return sent ? { success: true } : { success: false, error: "Error al enviar el email" };
  } catch (error) {
    console.error("Error resending order code:", error);
    return { success: false, error: "Error al enviar el email" };
  }
}

/** Aprueba o rechaza un pedido que requiere revisión (rechazar devuelve los puntos). */
export async function reviewOrder(orderId: number, approve: boolean, note: string) {
  const admin = await requireAdmin();
  if (!admin) return UNAUTHORIZED;

  try {
    return await reviewOrderCore(orderId, approve, note, admin.username);
  } catch (error) {
    console.error("Error reviewing order:", error);
    return { success: false as const, error: "Error al revisar el pedido" };
  }
}

/** Premio VIP sin verificación comprobada: se vuelve a poner en puja (sin devolver los puntos). */
export async function passOrderToNext(orderId: number, note: string) {
  const admin = await requireAdmin();
  if (!admin) return UNAUTHORIZED;

  try {
    return await passOrderToNextCore(orderId, note, admin.username);
  } catch (error) {
    console.error("Error passing order to next bid:", error);
    return { success: false as const, error: "Error al pasar el premio al siguiente" };
  }
}
