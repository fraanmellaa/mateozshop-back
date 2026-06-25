"use server";

import { createClient } from "@supabase/supabase-js";
import { sendCustomEmail } from "../email";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: "mateoz" },
  }
);

export async function updateOrderStatus(orderId: number, status: number) {
  try {
    const { error } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", orderId);

    if (error) {
      throw error;
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

export async function sendOrderEmail(
  userEmail: string,
  subject: string,
  message: string
) {
  try {
    const success = await sendCustomEmail(userEmail, subject, message);

    if (!success) {
      return { success: false, error: "Error al enviar el email" };
    }

    return { success: true };
  } catch (error) {
    console.error("Error sending order email:", error);
    return { success: false, error: "Error al enviar el email" };
  }
}
