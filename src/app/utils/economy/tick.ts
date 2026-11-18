import { syncLiveState } from "@/app/utils/live";
import { VipUnavailableError, vipWatchTick } from "@/app/utils/points/vip";
import { getShopSettings } from "@/app/utils/shop/settings";

import { rpc } from "./db";
import { isResetBlocking } from "./monthly";
import { getEconomySettings } from "./settings";

export type TickResult =
  | { status: "not_live" | "reset_pending" }
  | { status: "ok"; duplicate: boolean; minute: number; paid: number; points: number };

/**
 * Un minuto de economía: sincroniza el estado del directo y, si hay directo,
 * paga los minutos vistos (idempotente por minuto en SQL).
 */
export async function runEconomyTick(): Promise<TickResult> {
  const state = await syncLiveState();
  if (!state.live) return { status: "not_live" };

  if (await isResetBlocking()) return { status: "reset_pending" };

  const s = await getEconomySettings();
  const res = await rpc<{
    ok: boolean;
    reason?: string;
    duplicate?: boolean;
    minute?: number;
    paid?: number;
    points?: number;
  }>("economy_watch_tick", {
    p_points_per_minute: s.watch.pointsPerMinute,
    p_chat_window_seconds: s.watch.chatWindowMinutes * 60,
    p_streak_minutes: s.minutes.streak,
    p_bonus_from_day: s.streak.bonusFromDay,
    p_bonus_pct: s.streak.bonusPct,
    p_box_every: s.streak.boxEveryDays,
  });

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
