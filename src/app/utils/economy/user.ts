import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { rpc } from "./db";
import { streakDayPoints, streakWeeklyBonus, type DailyTier } from "./schema";
import { getEconomySettings } from "./settings";
import { adMonth } from "./time";

export type PublicTier = {
  id: string;
  label: string;
  kind: "points";
  pointsMin: number;
  pointsMax: number;
  name: string;
};

/** Un cobro de racha: el día de racha y lo que da (más el extra de la semana, si toca). */
export type StreakPayout = { day: number; points: number; weeklyBonus: number };

export type UserEconomy = {
  streak: {
    /** Racha efectiva: 0 si ya se ha roto (el siguiente día cualificado vuelve a 1). */
    current: number;
    best: number;
    lastDay: string | null;
    minutesToday: number;
    qualifiedToday: boolean;
    /** Minutos de directo al día para sumar racha y cobrar. */
    minutesNeeded: number;
    /**
     * Cobro de racha del último día de directo (el de hoy si hay directo), o
     * null si ese día no llegó a los minutos. `liveDay` identifica el cobro
     * y `at` es cuándo se cobró (segundos Unix).
     */
    collected: (StreakPayout & { liveDay: string; at: number | null }) | null;
    /**
     * Próximo cobro. `today` true: es el de hoy y aún no ha llegado a los
     * minutos; false: el del próximo día de directo.
     */
    next: StreakPayout & { today: boolean };
    weekly: { everyDays: number; points: number };
    /** Puntos por día de racha: `first` el día 1, `step` más cada día, hasta `max`. */
    dailyPoints: { first: number; step: number; max: number };
  };
  watch: {
    basePerMinute: number;
    /** Bonus en vigor: solo el del leaderboard del mes anterior (la racha ya no da porcentaje). */
    multiplierPct: number;
    chatActive: boolean;
    lastChatAt: number | null;
    live: { kick: boolean; twitch: boolean };
  };
  dailyBox: {
    available: boolean;
    minutesNeeded: number;
    minutesToday: number;
    claimedToday: boolean;
    tiers: PublicTier[];
  };
  monthBonus: { multiplierPct: number; month: string };
  balance: number;
};

/**
 * ¿Sigue viva la racha? Con directo abierto (día D): su último día es D o el
 * día de directo anterior. Sin directo: su último día es el último día de
 * directo (si se saltó ese directo, ya está rota).
 */
export function isStreakAlive(
  lastDay: string | null,
  live: boolean,
  liveDay: string | null,
  prevLiveDay: string | null
): boolean {
  if (!lastDay || !liveDay) return false;
  return live ? lastDay === liveDay || lastDay === prevLiveDay : lastDay === liveDay;
}

/** Premios de la caja diaria para el relleno visual: nombres, sin probabilidades. */
export function publicDailyTiers(tiers: DailyTier[]): PublicTier[] {
  return tiers.map((t) => ({
    id: t.id,
    label: t.label,
    kind: "points",
    pointsMin: t.pointsMin,
    pointsMax: t.pointsMax,
    name: t.pointsMin === t.pointsMax ? `${t.pointsMin} puntos` : `${t.pointsMin}–${t.pointsMax} puntos`,
  }));
}

const unwrap = (error: { message?: string } | null, what: string) => {
  if (error) throw new Error(`Economy ${what}: ${error.message}`);
};

export async function getUserEconomy(userId: number): Promise<UserEconomy> {
  const supabase = getSupabaseAdmin();
  const settings = await getEconomySettings();
  const nowSec = Math.floor(Date.now() / 1000);
  const month = adMonth();

  const [sessions, userRes, streakRes, chatRes, bonusRes, liveDayRaw] = await Promise.all([
    supabase.from("stream_sessions").select("platform").is("ended_at", null),
    supabase.from("users").select("total_points, used_points").eq("id", userId).limit(1),
    supabase.from("user_streaks").select("current_streak, best_streak, last_day, updated_at").eq("user_id", userId).limit(1),
    supabase.from("chat_activity").select("last_chat_at").eq("user_id", userId).limit(1),
    supabase.from("user_month_bonus").select("month, multiplier_pct").eq("user_id", userId).limit(1),
    rpc<string | null>("economy_live_day", {}),
  ]);
  unwrap(sessions.error, "sessions");
  unwrap(userRes.error, "user");
  unwrap(streakRes.error, "streak");
  unwrap(chatRes.error, "chat");
  unwrap(bonusRes.error, "month bonus");

  const user = userRes.data?.[0];
  const streak = streakRes.data?.[0];
  const lastChatAt: number | null = chatRes.data?.[0]?.last_chat_at ?? null;
  const open = new Set((sessions.data ?? []).map((s: { platform: string }) => s.platform));
  const live = open.size > 0;
  const liveDay = liveDayRaw ?? null;

  const prevLiveDay = liveDay
    ? await rpc<string | null>("economy_prev_live_day", { p_day: liveDay })
    : null;

  let minutesToday = 0;
  let claimedToday = false;
  if (liveDay) {
    const [watchRes, claimRes] = await Promise.all([
      supabase.from("user_watch_days").select("minutes").eq("user_id", userId).eq("day", liveDay).limit(1),
      supabase.from("daily_box_claims").select("id").eq("user_id", userId).eq("day", liveDay).limit(1),
    ]);
    unwrap(watchRes.error, "watch day");
    unwrap(claimRes.error, "claim");
    minutesToday = watchRes.data?.[0]?.minutes ?? 0;
    claimedToday = (claimRes.data?.length ?? 0) > 0;
  }

  const lastDay: string | null = streak?.last_day ?? null;
  const alive = isStreakAlive(lastDay, live, liveDay, prevLiveDay);
  const storedCurrent: number = streak?.current_streak ?? 0;
  const current = alive ? storedCurrent : 0;

  // Cobros de racha: el del último día de directo (si llegó a los minutos) y el próximo.
  const payout = (day: number): StreakPayout => ({
    day,
    points: streakDayPoints(settings.streak, day),
    weeklyBonus: streakWeeklyBonus(settings.streak, day),
  });
  const collectedNow = liveDay !== null && lastDay === liveDay && storedCurrent > 0;
  const bonusRow = bonusRes.data?.[0];
  const monthPct = bonusRow && bonusRow.month === month ? Number(bonusRow.multiplier_pct) : 0;

  const chatActive =
    lastChatAt !== null && lastChatAt >= nowSec - settings.watch.chatWindowMinutes * 60;

  return {
    streak: {
      current,
      best: streak?.best_streak ?? 0,
      lastDay,
      minutesToday,
      qualifiedToday: liveDay !== null && minutesToday >= settings.minutes.streak,
      minutesNeeded: settings.minutes.streak,
      collected:
        collectedNow && liveDay
          ? { ...payout(storedCurrent), liveDay, at: streak?.updated_at ?? null }
          : null,
      next: { ...payout(current + 1), today: live && !collectedNow },
      weekly: { everyDays: settings.streak.weeklyEveryDays, points: settings.streak.weeklyPoints },
      dailyPoints: {
        first: settings.streak.dailyFirst,
        step: settings.streak.dailyStep,
        max: settings.streak.dailyMax,
      },
    },
    watch: {
      basePerMinute: settings.watch.pointsPerMinute,
      multiplierPct: monthPct,
      chatActive,
      lastChatAt,
      live: { kick: open.has("kick"), twitch: open.has("twitch") },
    },
    dailyBox: {
      available:
        liveDay !== null && !claimedToday && minutesToday >= settings.minutes.dailyBox,
      minutesNeeded: settings.minutes.dailyBox,
      minutesToday,
      claimedToday,
      tiers: publicDailyTiers(settings.dailyBox.tiers),
    },
    monthBonus: { multiplierPct: monthPct, month },
    balance: user ? Number(user.total_points) - Number(user.used_points) : 0,
  };
}
