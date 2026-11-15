import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { settleAuction } from "./process";

/**
 * Cierre mensual: adjudica ya las subastas con pujas, sin esperar al reloj,
 * para que el reinicio de saldos no deje retenciones colgadas. Las subastas
 * que esperan (sin pujas) no se tocan. Idempotente: `auction_settle` solo
 * actúa sobre las que siguen en batalla, así que repetirlo no hace nada.
 *
 * Lo llama el reinicio mensual (utils/economy) ANTES de poner saldos a cero.
 * Si alguna falla, lanza: el reinicio no debe seguir con retenciones vivas.
 */
export async function closeMonthAuctions(): Promise<{ closed: number }> {
  const { data, error } = await getSupabaseAdmin()
    .from("products")
    .select("id")
    .eq("is_auction", true)
    .in("auction_status", ["in_progress", "finalizing"])
    .not("current_bidder_user_id", "is", null)
    .order("id", { ascending: true })
    .limit(1000);
  if (error) throw error;

  let closed = 0;
  const failed: number[] = [];

  for (const { id } of data || []) {
    try {
      const outcome = await settleAuction(id, true);
      if (outcome === "awarded" || outcome === "released") closed += 1;
    } catch (error) {
      failed.push(id);
      console.error(`[auctions] month close: product ${id} failed`, error);
    }
  }

  if (failed.length > 0) {
    throw new Error(`MONTH_CLOSE_AUCTIONS_FAILED: ${failed.join(",")}`);
  }

  return { closed };
}
