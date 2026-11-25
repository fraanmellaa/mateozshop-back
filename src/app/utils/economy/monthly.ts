import { VipUnavailableError, vipResetBalances } from "@/app/utils/points/vip";
import { isMissingFunction } from "@/app/utils/products/currency";
import { getShopSettings } from "@/app/utils/shop/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { closeMonthAuctions } from "@/app/utils/auctions/monthly";
import { closeMonthGiveaways } from "@/app/utils/giveaways/monthly";

import { rpc } from "./db";
import { invalidateLeaderboardCache } from "./leaderboard";
import { getEconomySettings } from "./settings";
import { adMonth, adParts, previousMonth } from "./time";

export type ResetRow = {
  month: string;
  closed_month: string;
  forced: boolean;
  started_at: number;
  locked_until: number | null;
  leaderboard_saved_at: number | null;
  auctions_closed_at: number | null;
  giveaways_closed_at: number | null;
  balances_reset_at: number | null;
  bonuses_granted_at: number | null;
  completed_at: number | null;
  auctions_closed: number | null;
  giveaways_closed: number | null;
  users_reset: number | null;
  bonus_users: number | null;
  error: string | null;
};

export type MonthlyResetResult =
  | { status: "not_due" | "disabled" | "already_done" | "locked"; month: string }
  | { status: "done"; month: string; closedMonth: string; steps: Record<string, number> }
  | { status: "failed"; month: string; step: string; error: string };

const LEASE_SECONDS = 600;
const BALANCE_CHUNK = 500;
const MAX_RUN_MS = 240_000;

const nowSec = () => Math.floor(Date.now() / 1000);
const MAX_BLOCK_SECONDS = 3 * 3600;

async function getRow(month: string): Promise<ResetRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("monthly_resets")
    .select("*")
    .eq("month", month)
    .limit(1);
  if (error) throw error;
  return (data?.[0] as ResetRow | undefined) ?? null;
}

/** Última fila de reinicio (para el panel). */
export async function getLastReset(): Promise<ResetRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("monthly_resets")
    .select("*")
    .order("month", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0] as ResetRow | undefined) ?? null;
}

/**
 * ¿Hay un reinicio mensual en curso o a punto de empezar? Mientras tanto el tick
 * y las lluvias no pagan: lo que se ganase se borraría al poner los saldos a 0.
 */
export async function isResetBlocking(): Promise<boolean> {
  const month = adMonth();
  const row = await getRow(month);
  // Un reinicio atascado no puede dejar la economía parada todo el mes: el
  // bloqueo caduca a las pocas horas (el admin puede reanudarlo a mano).
  if (row) return row.completed_at === null && nowSec() - row.started_at < MAX_BLOCK_SECONDS;

  const parts = adParts();
  if (parts.day !== 1 || parts.hour !== 0) return false;
  return (await getEconomySettings()).monthlyReset.enabled;
}

/**
 * Reinicio mensual. Automático: solo si en Andorra es día 1, hora 0 y el mes no
 * está hecho (o si hay uno a medias, que se reanuda a cualquier hora). `force`
 * lo lanza ahora para el mes en curso, si todavía no está hecho.
 *
 * Orden (cada paso con su marca en monthly_resets, idempotente y reanudable):
 *  1. guardar el top 50 del mes anterior desde point_transactions
 *  2. cerrar las subastas del mes (ninguna puja con puntos retenidos sobrevive)
 *  3. cerrar los sorteos del mes
 *  4. poner todos los saldos a 0 (un movimiento `monthly_reset` por usuario)
 *  5. conceder los puntos del leaderboard y el multiplicador del mes nuevo
 */
export async function runMonthlyReset(options: { force?: boolean } = {}): Promise<MonthlyResetResult> {
  const month = adMonth();
  const closedMonth = previousMonth(month);
  const settings = await getEconomySettings();

  const existing = await getRow(month);
  if (existing?.completed_at) return { status: "already_done", month };

  if (!options.force) {
    if (!existing) {
      // El día 1 a cualquier hora (no solo a las 00:xx): si el cron de la hora 0
      // falló, el siguiente lo recupera en vez de dejar el mes sin reiniciar.
      const parts = adParts();
      if (parts.day !== 1) return { status: "not_due", month };
      if (!settings.monthlyReset.enabled) return { status: "disabled", month };
    }
    // Con un reinicio a medias se reanuda siempre.
  }

  const begin = await rpc<{ state: "claimed" | "locked" | "done"; row: ResetRow }>(
    "economy_reset_begin",
    {
      p_month: month,
      p_closed: closedMonth,
      p_forced: Boolean(options.force),
      p_lease_seconds: LEASE_SECONDS,
    }
  );
  if (begin.state === "done") return { status: "already_done", month };
  if (begin.state === "locked") return { status: "locked", month };

  const supabase = getSupabaseAdmin();
  const row = begin.row;
  const steps: Record<string, number> = {};
  const startedMs = Date.now();
  let step = "leaderboard";

  const mark = async (values: Record<string, unknown>) => {
    const { error } = await supabase
      .from("monthly_resets")
      .update({ ...values, updated_at: nowSec() })
      .eq("month", month);
    if (error) throw error;
  };

  try {
    // 1. Top 50 del mes que se cierra, ANTES de tocar nada.
    await rpc("economy_reset_save_leaderboard", {
      p_month: month,
      p_closed: closedMonth,
      p_scale: settings.leaderboard.scale,
      p_limit: 50,
    });

    // 2. Subastas. Se repite mientras los saldos no estén a cero: el reinicio de
    // saldos (economy_reset_balances, migración 0039) se niega a empezar si
    // queda alguna puja con puntos retenidos, y al reanudar hay que volver a
    // cerrarlas. Es idempotente: sin pujas abiertas no hace nada.
    step = "auctions";
    if (!row.auctions_closed_at || !row.balances_reset_at) {
      const { closed } = await closeMonthAuctions();
      steps.auctions = closed;
      await mark({ auctions_closed_at: nowSec(), auctions_closed: (row.auctions_closed ?? 0) + closed });
    }

    // 2b. Stock mensual compartido (tiradas de casino, migración 0043): con las
    // pujas del mes ya cerradas, cada grupo vuelve a su stock del mes. Es
    // idempotente por mes; sin la migración no hay grupos y no se hace nada.
    step = "stock_groups";
    {
      const { data, error } = await supabase.rpc("shop_stock_groups_refill", { p_month: month });
      if (error) {
        if (!isMissingFunction(error, "shop_stock_groups_refill")) throw error;
      } else {
        steps.stockGroups = Number((data as { refilled?: number } | null)?.refilled ?? 0);
      }
    }

    // 3. Sorteos.
    step = "giveaways";
    if (!row.giveaways_closed_at) {
      const { closed } = await closeMonthGiveaways();
      steps.giveaways = closed;
      await mark({ giveaways_closed_at: nowSec(), giveaways_closed: closed });
    }

    // 4. Saldos a cero, por tandas.
    step = "balances";
    if (!row.balances_reset_at) {
      let total = 0;
      for (;;) {
        const res = await rpc<{ processed: number; remaining: number }>("economy_reset_balances", {
          p_month: month,
          p_limit: BALANCE_CHUNK,
        });
        total += res.processed;
        if (res.remaining === 0) break;
        if (res.processed === 0 || Date.now() - startedMs > MAX_RUN_MS) {
          throw new Error("Reinicio de saldos incompleto; se reanudará en la siguiente ejecución");
        }
      }
      steps.usersReset = total;
      await mark({ balances_reset_at: nowSec(), users_reset: (row.users_reset ?? 0) + total });
    }

    // 4b. Saldos VIP a cero, solo si el ajuste de la tienda lo pide. Es
    // idempotente por mes y usuario, así que no necesita su propia marca.
    step = "vip_balances";
    if ((await getShopSettings()).vipMonthlyReset === 1) {
      try {
        let totalVip = 0;
        for (;;) {
          const res = await vipResetBalances(month, BALANCE_CHUNK);
          totalVip += res.processed;
          if (res.remaining === 0) break;
          if (res.processed === 0 || Date.now() - startedMs > MAX_RUN_MS) {
            throw new Error("Reinicio de saldos VIP incompleto; se reanudará en la siguiente ejecución");
          }
        }
        steps.vipUsersReset = totalVip;
      } catch (error) {
        // Sin la migración 0032 no hay saldos VIP que reiniciar.
        if (!(error instanceof VipUnavailableError)) throw error;
      }
    }

    // 5. Bonus del leaderboard.
    step = "bonuses";
    if (!row.bonuses_granted_at) {
      const res = await rpc<{ granted: number }>("economy_reset_grant_bonuses", {
        p_month: month,
        p_closed: closedMonth,
      });
      steps.bonusUsers = res.granted;
      await mark({ bonuses_granted_at: nowSec(), bonus_users: (row.bonus_users ?? 0) + res.granted });
    }

    await mark({ completed_at: nowSec(), locked_until: null, error: null });
    invalidateLeaderboardCache();
    return { status: "done", month, closedMonth, steps };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ECONOMY] Reinicio mensual ${month} falló en «${step}»:`, error);
    await mark({ locked_until: null, error: `${step}: ${message}`.slice(0, 500) }).catch(() => {});
    return { status: "failed", month, step, error: message };
  }
}
