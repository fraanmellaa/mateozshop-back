import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendCustomEmail, sendEmail } from "../email";

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
