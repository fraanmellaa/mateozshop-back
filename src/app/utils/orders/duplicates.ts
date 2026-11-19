import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isMissingFunction } from "@/app/utils/products/currency";

/**
 * Cuentas repetidas (migración 0040). Cada pedido guarda el correo de entrega,
 * las cuentas de casino y la última IP del ganador; `orders_duplicate_flags`
 * dice si coinciden con los de otra cuenta. Son solo avisos para el panel: no
 * bloquean ninguna entrega. Mientras la migración no esté aplicada, no hay
 * avisos y todo sigue como antes.
 */

export type DuplicateFlag = {
  type: "email" | "casino" | "ip";
  text: string;
  /** Las otras cuentas con las que coincide. */
  users: { id: number; username: string }[];
};

export type OrderWinnerSnapshot = {
  delivery_email: string | null;
  casino_accounts: { casino: string; username: string; status: string }[];
  winner_ip: string | null;
};

type FlagRow = { order_id: number; flags: DuplicateFlag[] | null };

/** Avisos por pedido (id -> avisos). Sin `orderIds`, los de todos los pedidos sin cancelar. */
export async function getOrderDuplicateFlags(orderIds?: number[]): Promise<Map<number, DuplicateFlag[]>> {
  const result = new Map<number, DuplicateFlag[]>();
  if (orderIds && orderIds.length === 0) return result;

  const { data, error } = await getSupabaseAdmin().rpc("orders_duplicate_flags", {
    p_order_ids: orderIds ?? null,
  });
  if (error) {
    if (!isMissingFunction(error, "orders_duplicate_flags")) {
      console.error("Error loading duplicate account flags:", error);
    }
    return result;
  }
  for (const row of (data ?? []) as FlagRow[]) {
    if (Array.isArray(row.flags) && row.flags.length > 0) result.set(Number(row.order_id), row.flags);
  }
  return result;
}

/** Lo guardado en el pedido sobre su ganador; null si falta la migración 0040. */
export async function getOrderWinnerSnapshot(orderId: number): Promise<OrderWinnerSnapshot | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("orders")
    .select("delivery_email, casino_accounts, winner_ip")
    .eq("id", orderId)
    .limit(1);
  // Sin las columnas (migración sin aplicar) la consulta falla: no hay nada que enseñar.
  if (error || !data?.[0]) return null;
  const row = data[0] as { delivery_email?: string | null; casino_accounts?: unknown; winner_ip?: string | null };
  return {
    delivery_email: row.delivery_email ?? null,
    casino_accounts: Array.isArray(row.casino_accounts)
      ? (row.casino_accounts as OrderWinnerSnapshot["casino_accounts"])
      : [],
    winner_ip: row.winner_ip ?? null,
  };
}

const IP_PATTERN = /^[0-9a-f:.]{3,45}$/i;

/**
 * IP del visitante que reenvía la web en `x-client-ip` (el back solo recibe
 * peticiones del servidor de la web, con el bearer compartido). null si no viene
 * o no parece una IP.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const value = (headers.get("x-client-ip") ?? "").split(",")[0].trim();
  return IP_PATTERN.test(value) ? value.toLowerCase() : null;
}

/** Apunta la IP desde la que actúa un usuario. Nunca lanza: es un dato de apoyo. */
export async function recordUserIp(userId: number, ip: string | null): Promise<void> {
  if (!ip) return;
  try {
    const { error } = await getSupabaseAdmin().rpc("user_ip_touch", { p_user_id: userId, p_ip: ip });
    if (error && !isMissingFunction(error, "user_ip_touch")) {
      console.error("Error recording user IP:", error.message);
    }
  } catch (error) {
    console.error("Error recording user IP:", error instanceof Error ? error.message : "unknown");
  }
}
