import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { rpc } from "./db";
import type { DailyTier, EconomySettings } from "./schema";
import { getEconomySettings } from "./settings";
import { adMonth } from "./time";

export type PublicTier = {
  id: string;
  label: string;
  kind: "points" | "item";
  pointsMin: number;
  pointsMax: number;
  name: string;
};

export type UserEconomy = {
  streak: {
    /** Racha efectiva: 0 si ya se ha roto (el siguiente día cualificado vuelve a 1). */
    current: number;
    best: number;
    lastDay: string | null;
    minutesToday: number;
    qualifiedToday: boolean;
  };
  watch: {
    basePerMinute: number;
    /** Bonus total en vigor: racha (si está viva y ≥ día 7) + bonus del leaderboard. */
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
  streakBox: { available: number; everyDays: number; tiers: PublicTier[] };
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

export function publicDailyTiers(tiers: DailyTier[]): PublicTier[] {
  return tiers.map((t) =>
    t.kind === "points"
      ? { id: t.id, label: t.label, kind: "points", pointsMin: t.pointsMin, pointsMax: t.pointsMax, name: `${t.pointsMin}–${t.pointsMax} puntos` }
      : { id: t.id, label: t.label, kind: "item", pointsMin: 0, pointsMax: 0, name: t.name }
  );
}

export function publicStreakTiers(tiers: EconomySettings["streak"]["boxTiers"]): PublicTier[] {
  return [...tiers]
    .sort((a, b) => a.points - b.points)
    .map((t) => ({
      id: String(t.points),
      label: `${t.points} puntos`,
      kind: "points" as const,
      pointsMin: t.points,
      pointsMax: t.points,
      name: `${t.points} puntos`,
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

  const [sessions, userRes, streakRes, chatRes, entRes, bonusRes, liveDayRaw] = await Promise.all([
    supabase.from("stream_sessions").select("platform").is("ended_at", null),
    supabase.from("users").select("total_points, used_points").eq("id", userId).limit(1),
    supabase.from("user_streaks").select("current_streak, best_streak, last_day").eq("user_id", userId).limit(1),
    supabase.from("chat_activity").select("last_chat_at").eq("user_id", userId).limit(1),
    supabase
      .from("streak_box_entitlements")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("opened_at", null),
    supabase.from("user_month_bonus").select("month, multiplier_pct").eq("user_id", userId).limit(1),
    rpc<string | null>("economy_live_day", {}),
  ]);
  unwrap(sessions.error, "sessions");
  unwrap(userRes.error, "user");
  unwrap(streakRes.error, "streak");
  unwrap(chatRes.error, "chat");
  unwrap(entRes.error, "entitlements");
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

  const streakPct =
    alive && current >= settings.streak.bonusFromDay ? settings.streak.bonusPct : 0;
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
    },
    watch: {
      basePerMinute: settings.watch.pointsPerMinute,
      multiplierPct: streakPct + monthPct,
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
    streakBox: {
      available: entRes.count ?? 0,
      everyDays: settings.streak.boxEveryDays,
      tiers: publicStreakTiers(settings.streak.boxTiers),
    },
    monthBonus: { multiplierPct: monthPct, month },
    balance: user ? Number(user.total_points) - Number(user.used_points) : 0,
  };
}
