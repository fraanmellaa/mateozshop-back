import { syncLiveState } from "@/app/utils/live";
import { VipUnavailableError, vipWatchTick } from "@/app/utils/points/vip";
import { getShopSettings } from "@/app/utils/shop/settings";

import { rpc } from "./db";
import { isResetBlocking } from "./monthly";
import { getEconomySettings } from "./settings";

export type TickResult =
  | { status: "not_live" | "reset_pending" }
  | { status: "ok"; duplicate: boolean; minute: number; paid: number; points: number };

type TickRpc = {
  ok: boolean;
  reason?: string;
  duplicate?: boolean;
  minute?: number;
  paid?: number;
  points?: number;
};

/** PostgREST no encuentra la función con esos parámetros (migración sin aplicar). */
function isMissingFunction(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not find the function|PGRST202/i.test(message);
}

/**
 * Un minuto de economía: sincroniza el estado del directo y, si hay directo,
 * paga los minutos vistos (idempotente por minuto en SQL).
 */
export async function runEconomyTick(): Promise<TickResult> {
  const state = await syncLiveState();
  // Solo se paga con el directo confirmado encendido en esta misma lectura: una
  // sesión que sigue abierta por margen (la plataforma ya dice que no hay
  // directo, o lleva un rato sin contestar) no cobra.
  if (!state.live || !state.confirmed) return { status: "not_live" };

  if (await isResetBlocking()) return { status: "reset_pending" };

  const s = await getEconomySettings();
  const base = {
    p_points_per_minute: s.watch.pointsPerMinute,
    p_chat_window_seconds: s.watch.chatWindowMinutes * 60,
    p_streak_minutes: s.minutes.streak,
  };
  let res: TickRpc;
  try {
    res = await rpc<TickRpc>("economy_watch_tick", {
      ...base,
      p_streak_first: s.streak.dailyFirst,
      p_streak_step: s.streak.dailyStep,
      p_streak_max: s.streak.dailyMax,
      p_week_every: s.streak.weeklyEveryDays,
      p_week_points: s.streak.weeklyPoints,
    });
  } catch (error) {
    // Sin la migración 0037 la función aún tiene la forma antigua: se paga el
    // minuto con ella (sin bonus ni caja de racha) en vez de no pagar nada.
    if (!isMissingFunction(error)) throw error;
    res = await rpc<TickRpc>("economy_watch_tick", {
      ...base,
      p_bonus_from_day: 1,
      p_bonus_pct: 0,
      p_box_every: 0,
    });
  }

  if (!res.ok) return { status: "not_live" };

  // Puntos VIP de los verificados, en el mismo minuto. Va aparte y no puede
  // tumbar el reparto normal: si falla (o falta la migración 0032) solo se anota.
  try {
    const shop = await getShopSettings();
    const rates = {
      one: shop.vipPointsPerMinute,
      two: shop.vipPointsPerMinuteTwo,
      three: shop.vipPointsPerMinuteThree,
    };
    if (rates.one > 0 || rates.two > 0 || rates.three > 0) {
      await vipWatchTick(rates, s.watch.chatWindowMinutes * 60);
    }
  } catch (error) {
    if (!(error instanceof VipUnavailableError)) {
      console.error("[ECONOMY] Reparto de puntos VIP falló:", error);
    }
  }
  return {
    status: "ok",
    duplicate: Boolean(res.duplicate),
    minute: res.minute ?? 0,
    paid: res.paid ?? 0,
    points: res.points ?? 0,
  };
}
