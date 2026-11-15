import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { performGiveawayLottery } from "./lottery";

/**
 * Reinicio mensual (lo llama utils/economy ANTES de poner saldos a cero):
 * sortea ya todos los sorteos aún abiertos que tengan participantes y cierra
 * sin ganador los que no tengan. Idempotente: solo toca sorteos con
 * `winner IS NULL AND is_closed = false`, y cada cierre es un update
 * condicional; una segunda llamada no encuentra nada.
 */
export async function closeMonthGiveaways(): Promise<{ closed: number }> {
  const { data, error } = await getSupabaseAdmin()
    .from("giveaways")
    .select("id")
    .is("winner", null)
    .eq("is_closed", false)
    // Los sorteos programados para más adelante (aún no han empezado) pasan al mes nuevo.
    .lte("start_at", Math.floor(Date.now() / 1000))
    .order("id", { ascending: true });
  if (error) throw error;

  let closed = 0;
  const failed: number[] = [];
  for (const giveaway of data || []) {
    const result = await performGiveawayLottery(giveaway.id, { force: true });
    if (result.success) closed += 1;
    else failed.push(giveaway.id);
  }

  // Un sorteo que no se pudo cerrar no debe cruzar el reinicio en silencio:
  // se lanza para que el reinicio se reintente (igual que las subastas).
  if (failed.length > 0) {
    throw new Error(`No se pudieron cerrar los sorteos: ${failed.join(", ")}`);
  }
  return { closed };
}
