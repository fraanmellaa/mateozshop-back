import { assertAdult } from "@/app/utils/accounts/adult";
import { fairHistory, fairReserve, fairRotate, fairSetClientSeed, fairState } from "@/app/utils/fair";
import { getGamesSettings } from "@/app/utils/settings";
import {
  GamesSettings,
  effectiveMaxBet,
  plinkoTable,
} from "@/app/utils/settings/schema";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { playCrash } from "./crash";
import { GameError, dbError } from "./errors";
import { playMany } from "./plinko";
import { PLINKO_LEVEL_IDS, PlinkoLevelId } from "./table";

/**
 * Motor único de Crash y Plinko para la web y la extensión. Orden de cada
 * jugada: validar petición y estado (usuario, baneo, +18, rango, saldo, tope)
 * → reservar nonces (`fairReserve`, atómico) → calcular resultados en memoria
 * → liquidar TODO en una función SQL atómica (`games_settle`), que vuelve a
 * comprobar saldo y tope bajo bloqueo del usuario. La semilla secreta de
 * servidor solo vive aquí, en memoria, y nunca sale en una respuesta.
 */

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseAdmin().rpc(fn, args);
  if (error) throw dbError(error, fn);
  return data as T;
}

type Player = {
  id: number;
  isBanned: boolean;
  adultConfirmedAt: number | null;
  points: number;
};

async function loadPlayer(userId: number): Promise<Player> {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("id, is_banned, adult_confirmed_at, total_points, used_points")
    .eq("id", userId)
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new GameError("USER_NOT_FOUND", 404);
  return {
    id: row.id,
    isBanned: Boolean(row.is_banned),
    adultConfirmedAt: row.adult_confirmed_at ?? null,
    points: Number(row.total_points || 0) - Number(row.used_points || 0),
  };
}

const wageredToday = (userId: number) =>
  rpc<number>("games_wagered_today", { p_user_id: userId });

/** Comprobaciones previas a reservar nonce. La liquidación las repite bajo bloqueo. */
async function precheck(userId: number, totalBet: number, settings: GamesSettings) {
  const player = await loadPlayer(userId);
  if (player.isBanned) throw new GameError("USER_BANNED", 403);
  assertAdult({ adult_confirmed_at: player.adultConfirmedAt });
  if (player.points < totalBet) throw new GameError("INSUFFICIENT_POINTS", 400);

  const wagered = await wageredToday(userId);
  if (wagered + totalBet > settings.dailyWagerCap) {
    throw new GameError("DAILY_CAP_REACHED", 409, {
      remaining: Math.max(settings.dailyWagerCap - wagered, 0),
    });
  }
}

type RoundInput = { bet: number; payout: number; nonce: number; result: Record<string, unknown> };
type Settled = { balance: number; wagered_today: number; round_ids: string[] };

function settle(
  userId: number,
  game: "crash" | "plinko",
  reservation: { server_seed_hash: string; client_seed: string; nonce_start: number },
  rounds: RoundInput[],
  settings: GamesSettings
) {
  return rpc<Settled>("games_settle", {
    p_user_id: userId,
    p_game: game,
    // Único por reserva de nonces: reintentar la misma liquidación no cobra dos veces.
    p_request_id: `${userId}:${reservation.server_seed_hash.slice(0, 16)}:${reservation.nonce_start}`,
    p_daily_cap: settings.dailyWagerCap,
    p_server_seed_hash: reservation.server_seed_hash,
    p_client_seed: reservation.client_seed,
    p_rounds: rounds,
  });
}

const nextFair = (r: { server_seed_hash: string; client_seed: string }, nonce: number) => ({
  server_seed_hash: r.server_seed_hash,
  client_seed: r.client_seed,
  nonce,
});

/** Datos públicos de los juegos (sin semillas ni nada secreto). */
export function publicGamesConfig(settings: GamesSettings) {
  const levels = {} as Record<PlinkoLevelId, { table: number[]; rtp: number; maxBet: number }>;
  for (const id of PLINKO_LEVEL_IDS) {
    const { table, rtp } = plinkoTable(settings, id);
    levels[id] = { table, rtp, maxBet: effectiveMaxBet(settings.plinko, id) };
  }
  return {
    crash: {
      minBet: settings.crash.minBet,
      maxBet: settings.crash.maxBet,
      maxMult: settings.crash.maxMult,
      rtp: settings.crash.rtp,
    },
    plinko: {
      minBet: settings.plinko.minBet,
      maxBet: settings.plinko.maxBet,
      maxBalls: settings.plinko.maxBalls,
      levels,
    },
  };
}

export async function getGamesState(userId: number) {
  const settings = await getGamesSettings();
  const [player, wagered, fair] = await Promise.all([
    loadPlayer(userId),
    wageredToday(userId),
    fairState(userId),
  ]);
  return {
    points: player.points,
    wageredToday: wagered,
    dailyCap: settings.dailyWagerCap,
    fair,
    limits: {
      dailyWagerCap: settings.dailyWagerCap,
      remainingToday: Math.max(settings.dailyWagerCap - wagered, 0),
      maxBalls: settings.plinko.maxBalls,
    },
    ...publicGamesConfig(settings),
  };
}

function checkBet(bet: unknown, min: number, max: number): number {
  if (typeof bet !== "number" || !Number.isSafeInteger(bet) || bet < min || bet > max) {
    throw new GameError("BET_OUT_OF_RANGE", 400, { min, max });
  }
  return bet;
}

export async function playCrashRound(userId: number, input: { bet: unknown; target: unknown }) {
  const settings = await getGamesSettings();
  const cfg = settings.crash;

  const bet = checkBet(input.bet, cfg.minBet, cfg.maxBet);
  if (typeof input.target !== "number" || !Number.isFinite(input.target)) {
    throw new GameError("INVALID_TARGET", 400);
  }
  // El objetivo se normaliza a 2 decimales (igual que el punto de caída).
  const target = Math.round(input.target * 100) / 100;
  if (!(target >= 1.01 && target <= cfg.maxMult)) {
    throw new GameError("INVALID_TARGET", 400, { min: 1.01, max: cfg.maxMult });
  }

  await precheck(userId, bet, settings);

  const reservation = await fairReserve(userId, 1);
  const nonce = reservation.nonce_start;
  const r = playCrash(
    { bet, target, serverSeed: reservation.server_seed, clientSeed: reservation.client_seed, nonce },
    cfg
  );

  const settled = await settle(
    userId,
    "crash",
    reservation,
    [{ bet, payout: r.payout, nonce, result: { point: r.point, target, win: r.win } }],
    settings
  );

  return {
    point: r.point,
    win: r.win,
    payout: r.payout,
    points: settled.balance,
    round: { id: settled.round_ids[0], nonce },
    fair: nextFair(reservation, nonce + 1),
  };
}

export async function playPlinkoRounds(
  userId: number,
  input: { bet: unknown; risk: unknown; count?: unknown }
) {
  const settings = await getGamesSettings();
  const cfg = settings.plinko;

  if (typeof input.risk !== "string" || !(PLINKO_LEVEL_IDS as readonly string[]).includes(input.risk)) {
    throw new GameError("INVALID_RISK", 400);
  }
  const risk = input.risk as PlinkoLevelId;
  const maxBet = effectiveMaxBet(cfg, risk);
  const bet = checkBet(input.bet, cfg.minBet, maxBet);

  const count = input.count === undefined ? 1 : input.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > cfg.maxBalls) {
    throw new GameError("INVALID_COUNT", 400, { min: 1, max: cfg.maxBalls });
  }

  await precheck(userId, bet * count, settings);

  const { table } = plinkoTable(settings, risk);
  const reservation = await fairReserve(userId, count);
  const played = playMany({
    bet,
    table,
    count,
    serverSeed: reservation.server_seed,
    clientSeed: reservation.client_seed,
    nonceStart: reservation.nonce_start,
    maxBalls: cfg.maxBalls,
  });

  const settled = await settle(
    userId,
    "plinko",
    reservation,
    played.balls.map((b, i) => ({
      bet,
      payout: b.payout,
      nonce: reservation.nonce_start + i,
      result: { risk, path: b.path, slot: b.slot, mult: b.mult },
    })),
    settings
  );

  return {
    balls: played.balls.map((b) => ({ path: b.path, slot: b.slot, mult: b.mult, payout: b.payout })),
    totalBet: played.totalBet,
    totalPayout: played.totalPayout,
    points: settled.balance,
    nonceStart: reservation.nonce_start,
    fair: nextFair(reservation, played.nextNonce),
  };
}

const CLIENT_SEED = /^[A-Za-z0-9_-]{1,64}$/;

function checkClientSeed(seed: unknown): string {
  if (typeof seed !== "string" || !CLIENT_SEED.test(seed)) {
    throw new GameError("INVALID_CLIENT_SEED", 400);
  }
  return seed;
}

async function fairCall<T>(fn: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_CLIENT_SEED") {
      throw new GameError("INVALID_CLIENT_SEED", 400);
    }
    console.error(`${fn} failed:`, error instanceof Error ? error.message : "unknown");
    throw error;
  }
}

export async function setClientSeed(userId: number, clientSeed: unknown) {
  const seed = checkClientSeed(clientSeed);
  return { fair: await fairCall("fair_set_client_seed", () => fairSetClientSeed(userId, seed)) };
}

/** Rota la semilla de servidor: revela la anterior (para verificar) y empieza otra. */
export async function rotateSeed(userId: number, clientSeed: unknown) {
  const seed = clientSeed === undefined || clientSeed === null ? undefined : checkClientSeed(clientSeed);
  const result = await fairCall("fair_rotate", () => fairRotate(userId, seed));
  return { revealed: result.revealed, fair: result.current };
}

export async function getSeedHistory(userId: number) {
  return { seeds: await fairHistory(userId, 20) };
}

export async function getRoundHistory(userId: number) {
  const { data, error } = await getSupabaseAdmin()
    .from("game_rounds")
    .select("id, game, bet, payout, nonce, client_seed, server_seed_hash, result, created_at")
    .eq("user_id", userId)
    .in("game", ["crash", "plinko"])
    .not("nonce", "is", null)
    .order("created_at", { ascending: false })
    .order("nonce", { ascending: false })
    .limit(50);
  if (error) throw error;
  return { rounds: data ?? [] };
}
