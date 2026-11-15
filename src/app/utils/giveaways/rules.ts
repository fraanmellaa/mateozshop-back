import { getSupabaseAdmin } from "@/lib/supabase/admin";

const RECENT_DAYS = 60;
const MAX_ROWS = 50;

/**
 * Sorteos para las bases legales: los activos o por empezar y los terminados
 * en los últimos 60 días, con sus bases y el hash público del sorteo. La
 * semilla solo aparece una vez hecho el sorteo. Sin códigos ni datos privados.
 */
export async function getPublicGiveawayRules(): Promise<Record<string, unknown>> {
  const now = Math.floor(Date.now() / 1000);
  const since = now - RECENT_DAYS * 86400;

  const { data, error } = await getSupabaseAdmin()
    .from("giveaways")
    .select("id, title, cost, start_at, end_at, rules, draw_seed_hash, draw_seed, drawn_at, is_closed, winner")
    .or(`end_at.gte.${since},is_closed.eq.false`)
    .order("start_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw error;

  const giveaways = (data || []).map((g) => ({
    id: g.id as number,
    title: g.title as string,
    cost: g.cost as number,
    start_at: g.start_at as number,
    end_at: g.end_at as number,
    status:
      now < g.start_at ? "upcoming" : g.is_closed || g.winner || now >= g.end_at ? "finished" : "active",
    rules: (g.rules ?? null) as string | null,
    draw_seed_hash: (g.draw_seed_hash ?? null) as string | null,
    draw_seed: g.drawn_at !== null && g.drawn_at !== undefined ? ((g.draw_seed ?? null) as string | null) : null,
    drawn_at: (g.drawn_at ?? null) as number | null,
  }));

  return {
    method:
      "Compromiso-revelación: al crear el sorteo se publica el hash SHA-256 de una semilla secreta. Al sortear se revela la semilla; el ganador es la entrada en el índice floor(HMAC-SHA256(semilla, \"<clientSeed>:<nonce>:<cursor>\") x N), con clientSeed = id del sorteo, nonce 0 y cursor 0, sobre las N entradas válidas ordenadas por id (se excluyen los usuarios baneados).",
    giveaways,
  };
}
