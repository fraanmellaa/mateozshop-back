import { assertAdult } from "@/app/utils/accounts/adult";
import { getGamesSettings } from "@/app/utils/settings";
import { plinkoTable } from "@/app/utils/settings/schema";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { GameError, dbError } from "./errors";
import { dropBall } from "./plinko";

/**
 * Torneo semanal gratuito: cada entrada tiene sus tiradas de Plinko con
 * fichas (NO son puntos: no pasan por `points_move`). Cada entrada lleva su
 * propia semilla de servidor (hash visible; se revela al terminar la entrada o
 * el torneo). Las tiradas se calculan aquí y se aplican con `tournament_spin`,
 * que exige que el nonce coincida con las tiradas ya gastadas.
 */

const nowSeconds = () => Math.floor(Date.now() / 1000);

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseAdmin().rpc(fn, args);
  if (error) throw dbError(error, fn);
  return data as T;
}

type TournamentRow = {
  id: number;
  title: string;
  start_at: number;
  end_at: number;
  status: "open" | "closed";
  level: string;
  multipliers: number[];
  chips_per_spin: number;
  spins_per_entry: number;
  closed_at: number | null;
};

const TOURNAMENT_COLUMNS =
  "id, title, start_at, end_at, status, level, multipliers, chips_per_spin, spins_per_entry, closed_at";

export type TournamentStatus = "upcoming" | "active" | "closed";

export function tournamentStatus(t: Pick<TournamentRow, "start_at" | "end_at" | "status">, now = nowSeconds()): TournamentStatus {
  if (t.status === "closed" || now >= t.end_at) return "closed";
  if (now < t.start_at) return "upcoming";
  return "active";
}

type PrizeRow = {
  place: number;
  reward: string;
  winner_user_id: number | null;
  winner_chips: number | null;
};

async function loadPrizes(tournamentId: number) {
  const { data, error } = await getSupabaseAdmin()
    .from("tournament_prizes")
    .select("place, reward, winner_user_id, winner_chips")
    .eq("tournament_id", tournamentId)
    .order("place", { ascending: true });
  if (error) throw error;
  const prizes = (data ?? []) as PrizeRow[];

  const ids = prizes.map((p) => p.winner_user_id).filter((id): id is number => id !== null);
  const users = new Map<number, { username: string; image: string }>();
  if (ids.length > 0) {
    const { data: rows, error: usersError } = await getSupabaseAdmin()
      .from("users")
      .select("id, username, image")
      .in("id", ids);
    if (usersError) throw usersError;
    for (const u of rows ?? []) users.set(u.id, { username: u.username, image: u.image });
  }

  return prizes.map((p) => ({
    position: p.place,
    reward: p.reward,
    winner:
      p.winner_user_id !== null && users.has(p.winner_user_id)
        ? { ...users.get(p.winner_user_id)!, chips: Number(p.winner_chips ?? 0) }
        : null,
  }));
}

async function loadTournament(id: number): Promise<TournamentRow> {
  const { data, error } = await getSupabaseAdmin()
    .from("tournaments")
    .select(TOURNAMENT_COLUMNS)
    .eq("id", id)
    .limit(1);
  if (error) throw error;
  if (!data?.[0]) throw new GameError("TOURNAMENT_NOT_FOUND", 404);
  return data[0] as TournamentRow;
}

type EntryRow = {
  id: number;
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
  spins_used: number;
  chips: number;
  finished_at: number | null;
};

async function loadEntry(tournamentId: number, userId: number): Promise<EntryRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("tournament_entries")
    .select("id, server_seed, server_seed_hash, client_seed, spins_used, chips, finished_at")
    .eq("tournament_id", tournamentId)
    .eq("user_id", userId)
    .limit(1);
  if (error) throw error;
  return (data?.[0] as EntryRow | undefined) ?? null;
}

/** Estado público de una entrada. La semilla secreta solo sale cuando ya no se puede usar. */
function publicEntry(entry: EntryRow, t: TournamentRow, now = nowSeconds()) {
  const reveal = entry.finished_at !== null || tournamentStatus(t, now) === "closed";
  return {
    spinsUsed: entry.spins_used,
    spinsLeft: Math.max(t.spins_per_entry - entry.spins_used, 0),
    chips: Number(entry.chips),
    finishedAt: entry.finished_at,
    serverSeedHash: entry.server_seed_hash,
    clientSeed: entry.client_seed,
    serverSeed: reveal ? entry.server_seed : null,
  };
}

async function pickCurrent(now: number): Promise<TournamentRow | null> {
  const db = getSupabaseAdmin();

  const active = await db
    .from("tournaments")
    .select(TOURNAMENT_COLUMNS)
    .eq("status", "open")
    .lte("start_at", now)
    .gt("end_at", now)
    .order("start_at", { ascending: false })
    .limit(1);
  if (active.error) throw active.error;
  if (active.data?.[0]) return active.data[0] as TournamentRow;

  const upcoming = await db
    .from("tournaments")
    .select(TOURNAMENT_COLUMNS)
    .eq("status", "open")
    .gt("start_at", now)
    .order("start_at", { ascending: true })
    .limit(1);
  if (upcoming.error) throw upcoming.error;
  if (upcoming.data?.[0]) return upcoming.data[0] as TournamentRow;

  const last = await db
    .from("tournaments")
    .select(TOURNAMENT_COLUMNS)
    .order("end_at", { ascending: false })
    .limit(1);
  if (last.error) throw last.error;
  return (last.data?.[0] as TournamentRow | undefined) ?? null;
}

type UserGate = { isBanned: boolean; adult: boolean };

async function loadGate(userId: number): Promise<UserGate> {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("is_banned, adult_confirmed_at")
    .eq("id", userId)
    .limit(1);
  if (error) throw error;
  if (!data?.[0]) throw new GameError("USER_NOT_FOUND", 404);
  return { isBanned: Boolean(data[0].is_banned), adult: Boolean(data[0].adult_confirmed_at) };
}

/** `userId` null = visitante sin sesión: solo ve el torneo y el ranking público. */
export async function getCurrentTournament(userId: number | null) {
  const now = nowSeconds();
  const t = await pickCurrent(now);
  if (!t) {
    return { tournament: null, entry: null, eligible: false, eligibleReason: "NO_TOURNAMENT", ranking: [], me: null };
  }

  const status = tournamentStatus(t, now);
  const [prizes, entry, gate, ranking] = await Promise.all([
    loadPrizes(t.id),
    userId === null ? Promise.resolve(null) : loadEntry(t.id, userId),
    userId === null ? Promise.resolve(null) : loadGate(userId),
    rpc<{ ranking: unknown[]; me: { position: number; chips: number } | null }>("tournament_ranking", {
      p_tournament_id: t.id,
      p_limit: 50,
      p_user_id: userId,
    }),
  ]);

  let eligible = false;
  let eligibleReason: string | null = null;
  if (userId === null || gate === null) {
    eligibleReason = "LOGIN_REQUIRED";
  } else if (entry) {
    eligible = true;
  } else if (status !== "active") {
    eligibleReason = status === "upcoming" ? "NOT_STARTED" : "TOURNAMENT_CLOSED";
  } else if (gate.isBanned) {
    eligibleReason = "USER_BANNED";
  } else if (!gate.adult) {
    eligibleReason = "ADULT_REQUIRED";
  } else {
    eligible = await rpc<boolean>("tournament_is_eligible", {
      p_user_id: userId,
      p_tournament_id: t.id,
    });
    if (!eligible) eligibleReason = "NO_STREAM_WATCHED";
  }

  return {
    tournament: {
      id: t.id,
      title: t.title,
      startAt: t.start_at,
      endAt: t.end_at,
      status,
      level: t.level,
      chipsPerSpin: t.chips_per_spin,
      spinsPerEntry: t.spins_per_entry,
      table: t.multipliers,
      prizes,
    },
    entry: entry ? publicEntry(entry, t, now) : null,
    eligible,
    eligibleReason,
    ranking: ranking.ranking,
    me: ranking.me ? { position: ranking.me.position } : null,
  };
}

export async function joinTournament(userId: number, tournamentId: number) {
  const gate = await loadGate(userId);
  if (gate.isBanned) throw new GameError("USER_BANNED", 403);
  assertAdult({ adult_confirmed_at: gate.adult ? 1 : null });

  const t = await loadTournament(tournamentId);
  await rpc("tournament_join", { p_tournament_id: t.id, p_user_id: userId });
  const entry = await loadEntry(t.id, userId);
  if (!entry) throw new GameError("ENTRY_NOT_FOUND", 404);
  return { entry: publicEntry(entry, t) };
}

export async function spinTournament(userId: number, tournamentId: number, count: unknown) {
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 100) {
    throw new GameError("INVALID_COUNT", 400, { min: 1, max: 100 });
  }

  const gate = await loadGate(userId);
  if (gate.isBanned) throw new GameError("USER_BANNED", 403);

  // Si otra tirada de la misma entrada se adelanta (STALE_ENTRY), se recalcula
  // con el nonce nuevo; nunca se aplican dos lotes con el mismo nonce.
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = await loadTournament(tournamentId);
    if (tournamentStatus(t) !== "active") throw new GameError("TOURNAMENT_NOT_OPEN", 409);

    const entry = await loadEntry(t.id, userId);
    if (!entry) throw new GameError("ENTRY_NOT_FOUND", 404);

    const left = t.spins_per_entry - entry.spins_used;
    if (left <= 0) throw new GameError("NO_SPINS_LEFT", 409);
    const n = Math.min(count, left);

    const balls = Array.from({ length: n }, (_, i) => {
      const { path, slot } = dropBall(entry.server_seed, entry.client_seed, entry.spins_used + i);
      const mult = t.multipliers[slot];
      return { path, slot, mult, chipsWon: Math.floor(t.chips_per_spin * mult) };
    });

    try {
      const result = await rpc<{ chips: number; spins_used: number; spins_left: number; finished: boolean }>(
        "tournament_spin",
        {
          p_entry_id: entry.id,
          p_user_id: userId,
          p_expected_used: entry.spins_used,
          p_chips: balls.map((b) => b.chipsWon),
        }
      );
      return {
        balls,
        chips: Number(result.chips),
        spinsUsed: result.spins_used,
        spinsLeft: result.spins_left,
        finished: result.finished,
        serverSeed: result.finished ? entry.server_seed : null,
      };
    } catch (error) {
      if (error instanceof GameError && error.code === "STALE_ENTRY" && attempt < 2) continue;
      throw error;
    }
  }
  throw new GameError("STALE_ENTRY", 409);
}

// ───────────────────────── administración ─────────────────────────

export type TournamentPrizeInput = { place: number; reward: string };

export async function createTournament(input: {
  title: string;
  startAt: number;
  endAt: number;
  prizes: TournamentPrizeInput[];
}) {
  const settings = await getGamesSettings();
  const { level, chipsPerSpin, spinsPerEntry } = settings.tournament;
  // La tabla se fija ahora: cambiar los ajustes después no altera un torneo en marcha.
  const { table } = plinkoTable(settings, level);

  return rpc<number>("tournament_create", {
    p_title: input.title,
    p_start_at: input.startAt,
    p_end_at: input.endAt,
    p_level: level,
    p_multipliers: table,
    p_chips_per_spin: chipsPerSpin,
    p_spins_per_entry: spinsPerEntry,
    p_prizes: input.prizes,
  });
}

export async function listTournaments() {
  const { data, error } = await getSupabaseAdmin()
    .from("tournaments")
    .select(TOURNAMENT_COLUMNS)
    .order("start_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const rows = (data ?? []) as TournamentRow[];
  const now = nowSeconds();

  return Promise.all(
    rows.map(async (t) => {
      const [prizes, entries] = await Promise.all([
        loadPrizes(t.id),
        getSupabaseAdmin()
          .from("tournament_entries")
          .select("id", { count: "exact", head: true })
          .eq("tournament_id", t.id),
      ]);
      return {
        id: t.id,
        title: t.title,
        startAt: t.start_at,
        endAt: t.end_at,
        status: tournamentStatus(t, now),
        closed: t.status === "closed",
        level: t.level,
        chipsPerSpin: t.chips_per_spin,
        spinsPerEntry: t.spins_per_entry,
        entries: entries.count ?? 0,
        prizes,
      };
    })
  );
}

export type AdminTournament = Awaited<ReturnType<typeof listTournaments>>[number];

export async function getTournamentAdmin(id: number) {
  const t = await loadTournament(id);
  const [prizes, ranking] = await Promise.all([
    loadPrizes(t.id),
    rpc<{ ranking: unknown[] }>("tournament_ranking", {
      p_tournament_id: t.id,
      p_limit: 200,
      p_user_id: null,
    }),
  ]);
  return {
    id: t.id,
    title: t.title,
    startAt: t.start_at,
    endAt: t.end_at,
    status: tournamentStatus(t),
    closed: t.status === "closed",
    prizes,
    ranking: ranking.ranking,
  };
}

export async function closeTournament(id: number) {
  return rpc<{ already_closed: boolean }>("tournament_close", { p_tournament_id: id });
}

/** Cierra los torneos cuya hora de fin ya pasó (cron). */
export async function closeExpiredTournaments() {
  const { data, error } = await getSupabaseAdmin()
    .from("tournaments")
    .select("id")
    .eq("status", "open")
    .lte("end_at", nowSeconds());
  if (error) throw error;

  const results: { id: number; ok: boolean }[] = [];
  for (const row of data ?? []) {
    try {
      await closeTournament(row.id);
      results.push({ id: row.id, ok: true });
    } catch (closeError) {
      console.error(`Tournament ${row.id} could not be closed:`, closeError instanceof Error ? closeError.message : "unknown");
      results.push({ id: row.id, ok: false });
    }
  }
  return results;
}
