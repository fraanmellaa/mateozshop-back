"use server";

import { db } from "@/db/drizzle";
import { orders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendCustomEmail } from "../email";

export async function updateOrderStatus(orderId: number, status: number) {
  try {
    await db
      .update(orders)
      .set({
        status,
      })
      .where(eq(orders.id, orderId));

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
