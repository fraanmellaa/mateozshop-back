import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/app/utils/giveaways/fetchAll";
import { isMissingTable } from "@/app/utils/products/currency";

/**
 * Embudo por casino para el panel: clics en «Conseguir bono» (migración 0033),
 * solicitudes de verificación enviadas y aprobadas (migración 0032). Los casinos
 * se juntan por nombre sin distinguir mayúsculas.
 */
export type CasinoFunnelRow = {
  casino: string;
  /** null si aún no existe el contador de clics (falta la migración 0033). */
  clicks: number | null;
  requests: number;
  approved: number;
};

export async function getCasinoFunnel(): Promise<CasinoFunnelRow[]> {
  const db = getSupabaseAdmin();
  const rows = new Map<string, CasinoFunnelRow>();
  const row = (name: string) => {
    const key = name.trim().toLowerCase();
    let item = rows.get(key);
    if (!item) {
      item = { casino: name.trim(), clicks: 0, requests: 0, approved: 0 };
      rows.set(key, item);
    }
    return item;
  };

  // Todos los casinos con bono activo salen aunque estén a cero.
  const { data: bonuses, error: bonusError } = await db.from("bonuses").select("casino_name").eq("is_active", true);
  if (bonusError) throw bonusError;
  for (const bonus of bonuses ?? []) if (bonus.casino_name) row(String(bonus.casino_name));

  let clicksAvailable = true;
  try {
    const clicks = await fetchAllRows<{ casino_name: string; clicks: number }>((from, to) =>
      db.from("bonus_click_stats").select("casino_name, clicks").order("day", { ascending: true }).range(from, to)
    );
    for (const c of clicks) if (c.casino_name) row(c.casino_name).clicks! += Number(c.clicks) || 0;
  } catch (error) {
    if (!isMissingTable(error, "bonus_click_stats")) throw error;
    clicksAvailable = false;
  }

  try {
    const requests = await fetchAllRows<{ casino: string; status: string }>((from, to) =>
      db.from("verification_requests").select("casino, status").order("id", { ascending: true }).range(from, to)
    );
    for (const r of requests) {
      const item = row(r.casino);
      item.requests += 1;
      // Una verificación retirada después también fue aprobada en su día.
      if (r.status === "approved" || r.status === "revoked") item.approved += 1;
    }
  } catch (error) {
    if (!isMissingTable(error, "verification_requests")) throw error;
  }

  return [...rows.values()]
    .map((item) => ({ ...item, clicks: clicksAvailable ? item.clicks : null }))
    .sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0) || b.requests - a.requests || a.casino.localeCompare(b.casino));
}
