import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isMissingFunction } from "@/app/utils/products/currency";
import { sendCustomEmail, sendEmail, sendWinnerNotificationEmail } from "../email";

/**
 * Revisión manual de pedidos (premios de más de `reviewThresholdEur`).
 * Lo comparten la server action del panel y `POST /api/admin/orders/[id]/review`.
 * La decisión y la devolución de puntos las hace `order_review` (SQL, atómico e
 * idempotente); aquí solo la entrega y los avisos, que no deshacen la decisión.
 */

export type ReviewResult =
  | { success: true; action: "approved" | "rejected" | "none"; warning?: string }
  | { success: false; error: string };

type ReviewRpc =
  | { action: "none"; reason: string }
  | { action: "approved"; order_id: number; user_id: number; code: string | null; product_id: number }
  | { action: "rejected"; order_id: number; user_id: number };

export async function reviewOrderCore(
  orderId: number,
  approve: boolean,
  note: string | null,
  adminName: string
): Promise<ReviewResult> {
  if (!Number.isInteger(orderId)) return { success: false, error: "Pedido no válido" };

  const cleanNote = (note ?? "").trim().slice(0, 500);
  if (!approve && !cleanNote) {
    return { success: false, error: "Indica el motivo del rechazo" };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("order_review", {
    p_order_id: orderId,
    p_approve: approve,
    p_admin: adminName,
    p_note: cleanNote || null,
  });

  if (error) {
    if (String(error.message).trim() === "ORDER_NOT_FOUND") {
      return { success: false, error: "Pedido no encontrado" };
    }
    console.error(`Order ${orderId}: review failed`, error);
    return { success: false, error: "Error al revisar el pedido" };
  }

  const result = data as ReviewRpc;

  if (result.action === "none") {
    const reason =
      result.reason === "cancelled"
        ? "El pedido está cancelado"
        : result.reason === "already_reviewed"
          ? "El pedido ya se revisó"
          : "Este pedido no requiere revisión";
    return { success: false, error: reason };
  }

  const { data: users } = await supabase
    .from("users")
    .select("email")
    .eq("id", result.user_id)
    .limit(1);
  const email: string | null = users?.[0]?.email ?? null;

  if (result.action === "rejected") {
    if (email) {
      const sent = await sendCustomEmail(
        email,
        "Tu premio no ha superado la revisión",
        `Hemos revisado tu pedido #${result.order_id} y no podemos entregarlo.\n\nMotivo: ${cleanNote}\n\nTe hemos devuelto los puntos de la puja.`
      ).catch(() => false);
      if (!sent) console.error(`Order ${orderId}: rejection email not sent`);
    }
    return { success: true, action: "rejected" };
  }

  // Aprobado: con código reservado se envía ya y el pedido se completa; sin
  // código, queda en la cola de entregas para hacerla a mano.
  if (result.code) {
    let sent = false;
    try {
      sent = email ? await sendEmail(email, "PRODUCT_WITH_REWARD", result.code) : false;
    } catch (sendError) {
      console.error(`Order ${orderId}: code email failed`, sendError);
    }

    const { error: updateError } = await supabase
      .from("orders")
      .update(sent ? { code_email_sent: true, status: 1 } : { code_email_sent: false })
      .eq("id", orderId)
      .neq("status", 2);
    if (updateError) console.error(`Order ${orderId}: could not store delivery`, updateError);

    if (!sent) {
      return {
        success: true,
        action: "approved",
        warning: "Aprobado, pero el email con el código no se pudo enviar. Reenvíalo desde el pedido.",
      };
    }
  }

  return { success: true, action: "approved" };
}

// ───────────────────── premios VIP: pasar al siguiente ─────────────────────

export type PassNextResult =
  | { success: true; action: "passed"; newOrderId: number; username: string | null }
  | { success: true; action: "reopened" }
  | { success: false; error: string };

type PassNextRpc =
  | { action: "none"; reason: string }
  | {
      action: "passed";
      order_id: number;
      previous_user_id: number;
      new_order_id: number;
      user_id: number;
      amount: number;
      charged: number;
      product_id: number;
    }
  | { action: "reopened"; order_id: number; previous_user_id: number; product_id: number; reopened: boolean };

const PASS_NONE: Record<string, string> = {
  cancelled: "El pedido está cancelado",
  already_reviewed: "El pedido ya se comprobó",
  not_vip: "Solo se puede pasar al siguiente un premio VIP",
  no_review: "Este pedido no está pendiente de comprobar",
  product_missing: "El premio de este pedido ya no existe",
};

/**
 * «Pasar al siguiente» (migración 0035): el ganador de una puja VIP no ha
 * podido acreditar su verificación. `order_pass_next` anula su pedido, le
 * devuelve los puntos VIP y adjudica el premio a la siguiente puja más alta; si
 * no queda nadie, el premio se vuelve a poner en puja. Aquí solo los avisos.
 */
export async function passOrderToNextCore(
  orderId: number,
  note: string | null,
  adminName: string
): Promise<PassNextResult> {
  if (!Number.isInteger(orderId)) return { success: false, error: "Pedido no válido" };

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("order_pass_next", {
    p_order_id: orderId,
    p_admin: adminName,
    p_note: (note ?? "").trim().slice(0, 500) || null,
  });

  if (error) {
    if (isMissingFunction(error, "order_pass_next")) {
      return { success: false, error: "Falta aplicar la migración 0035 en la base de datos" };
    }
    if (String(error.message).trim() === "ORDER_NOT_FOUND") {
      return { success: false, error: "Pedido no encontrado" };
    }
    console.error(`Order ${orderId}: pass to next failed`, error);
    return { success: false, error: "Error al pasar el premio al siguiente" };
  }

  const result = data as PassNextRpc;
  if (result.action === "none") {
    return { success: false, error: PASS_NONE[result.reason] ?? "No se puede pasar este pedido" };
  }

  const userIds = [result.previous_user_id, ...(result.action === "passed" ? [result.user_id] : [])];
  const [{ data: users }, { data: products }] = await Promise.all([
    supabase.from("users").select("id, username, email").in("id", userIds),
    supabase.from("products").select("name").eq("id", result.product_id).limit(1),
  ]);
  const productName: string = products?.[0]?.name ?? "tu premio";
  const previous = users?.find((user) => user.id === result.previous_user_id);
  const next = result.action === "passed" ? users?.find((user) => user.id === result.user_id) : undefined;

  // Los avisos no deshacen la decisión: si fallan, solo se anota.
  if (previous?.email) {
    const sent = await sendCustomEmail(
      previous.email,
      "No hemos podido comprobar tu verificación",
      `Ganaste la puja de ${productName}, pero no hemos podido comprobar tu verificación y no podemos entregártelo (pedido #${result.order_id}).\n\nTe hemos devuelto los puntos VIP de la puja.`
    ).catch(() => false);
    if (!sent) console.error(`Order ${orderId}: pass-next email to previous winner not sent`);
  }

  if (result.action === "reopened") return { success: true, action: "reopened" };

  if (next?.email) {
    const sent = await sendWinnerNotificationEmail({
      to: next.email,
      subject: `El premio ${productName} pasa a ti`,
      title: "Has ganado una puja",
      intro: `La puja ganadora de ${productName} no ha podido entregarse y el premio pasa a la siguiente puja más alta, que es la tuya. Antes de entregarlo comprobamos tu verificación; te avisaremos cuando esté listo.`,
      details: [`Premio: ${productName}`, `Tu puja: ${result.amount} puntos VIP`],
      ctaLabel: "Ver mis pedidos",
      ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://mateozshop.com"}/mi-cuenta/pedidos`,
    }).catch(() => false);
    if (!sent) console.error(`Order ${orderId}: pass-next email to new winner not sent`);
  }

  return { success: true, action: "passed", newOrderId: result.new_order_id, username: next?.username ?? null };
}
