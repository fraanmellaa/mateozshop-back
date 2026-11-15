import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { rpc } from "./db";
import { getEconomySettings } from "./settings";
import { adMonth } from "./time";

export type LeaderboardEntry = {
  position: number;
  username: string;
  image: string | null;
  points: number;
};

export type MonthlyLeaderboard = {
  month: string;
  entries: LeaderboardEntry[];
  me: { position: number; points: number } | null;
  nextMonthBonuses: { from: number; to: number; points: number; multiplierPct: number }[];
};

type BoardRpc = {
  entries: { place: number; username: string; image: string | null; points: number }[];
  me: { place: number; points: number } | null;
};

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: BoardRpc; expiresAt: number }>();

/** Tras un reinicio los resultados cambian de golpe: se descarta lo cacheado. */
export function invalidateLeaderboardCache() {
  cache.clear();
}

async function loadBoard(month: string, userId: number | null): Promise<BoardRpc> {
  // Un mes ya cerrado sale de la copia guardada en el reinicio.
  if (month < adMonth()) {
    const { data, error } = await getSupabaseAdmin()
      .from("monthly_leaderboard_results")
      .select("place, user_id, username, image, points")
      .eq("month", month)
      .order("place", { ascending: true });
    if (error) throw error;
    if (data && data.length > 0) {
      const me = userId === null ? undefined : data.find((r) => r.user_id === userId);
      return {
        entries: data.map((r) => ({
          place: r.place,
          username: r.username ?? "",
          image: r.image ?? null,
          points: Number(r.points),
        })),
        me: me ? { place: me.place, points: Number(me.points) } : null,
      };
    }
  }

  return rpc<BoardRpc>("economy_month_board", {
    p_month: month,
    p_user_id: userId,
    p_limit: 50,
  });
}

/** Top 50 del mes (caché de 30 s) y, si se pide, la posición del usuario. */
export async function getMonthlyLeaderboard(
  month: string,
  userId: number | null = null
): Promise<MonthlyLeaderboard> {
  const key = `${month}:${userId ?? ""}`;
  let board = cache.get(key);
  if (!board || Date.now() >= board.expiresAt) {
    if (cache.size > 500) cache.clear();
    board = {
      value: await loadBoard(month, userId),
      // La consulta por usuario recorre el libro del mes: se cachea más tiempo.
      expiresAt: Date.now() + (userId === null ? CACHE_TTL_MS : CACHE_TTL_MS * 4),
    };
    cache.set(key, board);
  }

  const settings = await getEconomySettings();
  return {
    month,
    entries: board.value.entries.map((e) => ({
      position: e.place,
      username: e.username,
      image: e.image,
      points: e.points,
    })),
    me: board.value.me ? { position: board.value.me.place, points: board.value.me.points } : null,
    nextMonthBonuses: [...settings.leaderboard.scale]
      .sort((a, b) => a.from - b.from)
      .map((s) => ({ from: s.from, to: s.to, points: s.points, multiplierPct: s.multiplierPct })),
  };
}
