import { hashSeed, newServerSeed } from "@/app/utils/fair/rng";
import { getGamesSettings } from "@/app/utils/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

import {
  CRASH_BET_MS,
  CRASH_GROWTH_PER_SEC,
  CRASH_PAUSE_MS,
  CRASH_PUBLIC_SEED,
  crashRoundPoint,
} from "./crash";
import { GameError, dbError } from "./errors";

/**
 * Crash compartido: una ronda global para todos (funciones SQL de la 0029;
 * el razonamiento de RTP y de fugas está en `crash.ts`).
 *
 * El ciclo avanza de forma perezosa: cada consulta llama a `crash_tick`, que
 * liquida la ronda si ya explotó y, si toca, crea la siguiente con la semilla
 * y el punto que se generan aquí. La semilla y el punto de la ronda en curso
 * NO pasan por este módulo salvo en el instante de crearla (no se guardan en
 * memoria): lo que devuelve la BD ya viene sin ellos hasta que la ronda queda
 * liquidada.
 */

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseAdmin().rpc(fn, args);
  if (error) throw dbError(error, fn);
  return data as T;
}

type BetStatus = "active" | "won" | "lost";

type ViewRound = {
  id: number;
  phase: "betting" | "flying" | "crashed";
  server_seed_hash: string;
  starts_at_ms: number;
  growth: number;
  rtp: number;
  max_mult: number;
  // Solo con la ronda liquidada:
  point?: number;
  server_seed?: string;
  crash_at_ms?: number;
};

type ViewPlayer = {
  user_id: number;
  name: string;
  bet: number;
  auto: number | null;
  status: BetStatus;
  mode: string | null;
  cashout: number | null;
  payout: number;
};

type ViewHistory = {
  id: number;
  point: number;
  server_seed: string;
  server_seed_hash: string;
  rtp: number;
  max_mult: number;
};

/** Lo que devuelve `crash_view` / `crash_tick`. */
type View = {
  now_ms: number;
  round: ViewRound | null;
  players: ViewPlayer[];
  players_count: number;
  players_total: number;
  history: ViewHistory[];
  next_id: number | null;
  next_at_ms: number | null;
};

type BetRow = {
  round_id: number;
  bet: number;
  auto: number | null;
  status: BetStatus;
  mode: string | null;
  cashout: number | null;
  payout: number;
};

/** Avanza el ciclo y, si toca, crea la ronda siguiente (dos llamadas como mucho). */
async function tick(): Promise<View> {
  const view = await rpc<View>("crash_tick", {});
  const due =
    view.next_id !== null && (view.next_at_ms === null || view.now_ms >= view.next_at_ms);
  if (!due || view.next_id === null) return view;

  const cfg = (await getGamesSettings()).crash;
  const seed = newServerSeed();
  // Siempre con 2 decimales (el máximo configurado podría tener más).
  const point = Math.floor(crashRoundPoint(seed, view.next_id, cfg) * 100 + 1e-9) / 100;

  // Candidato: la BD solo lo usa si de verdad toca crear esa ronda.
  return rpc<View>("crash_tick", {
    p_next_id: view.next_id,
    p_server_seed: seed,
    p_server_seed_hash: hashSeed(seed),
    p_point: point,
    p_rtp: cfg.rtp,
    p_max_mult: cfg.maxMult,
    p_growth: CRASH_GROWTH_PER_SEC,
    p_bet_ms: CRASH_BET_MS,
    p_pause_ms: CRASH_PAUSE_MS,
  });
}

// Caché en memoria de la parte COMÚN (por instancia): con muchos jugadores
// sondeando, la BD recibe como mucho ~4 consultas por segundo e instancia.
// Nada personal se guarda aquí.
const CACHE_MS = 250;
let cached: { at: number; view: View } | null = null;
let inflight: Promise<{ at: number; view: View }> | null = null;

async function sharedView(): Promise<{ at: number; view: View }> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached;
  if (!inflight) {
    inflight = tick()
      .then((view) => {
        cached = { at: Date.now(), view };
        return cached;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

function dropCache() {
  cached = null;
}

/**
 * Liquida la ronda si ya explotó (para que el saldo esté al día aunque nadie
 * tenga Crash abierto). No lanza: si falla, el resto de juegos sigue.
 */
export async function crashSettleIfDue(): Promise<void> {
  try {
    await sharedView();
  } catch (error) {
    console.error("crash tick failed:", error instanceof Error ? error.message : "unknown");
  }
}

const betPublic = (b: BetRow | ViewPlayer, roundId: number) => ({
  roundId,
  bet: b.bet,
  autoCashout: b.auto ?? null,
  status: b.status,
  // manual | auto | max (llegó al máximo) | bust (explotó) | void (cruzó el reinicio mensual)
  mode: b.mode ?? null,
  cashout: b.cashout ?? null,
  payout: b.payout ?? 0,
});

const PLAYERS_SHOWN = 30;

/**
 * Estado del ciclo para quien pregunta. Lista blanca explícita: `point`,
 * `serverSeed` y `crashAtMs` solo se copian si la BD los ha enviado (ronda ya
 * liquidada); de los demás jugadores no sale ni su id ni su objetivo automático.
 */
export async function getCrashRound(userId: number, points: number) {
  const { at, view } = await sharedView();
  const round = view.round;

  let mine: BetRow | ViewPlayer | null = null;
  if (round) {
    mine = view.players.find((p) => p.user_id === userId) ?? null;
    // La lista viene recortada cuando hay muchísimos jugadores: se mira en la BD.
    if (!mine && view.players_count > view.players.length) {
      const { data, error } = await getSupabaseAdmin()
        .from("crash_bets")
        .select("round_id, bet, auto:auto_cashout, status, mode, cashout, payout")
        .eq("round_id", round.id)
        .eq("user_id", userId)
        .limit(1);
      if (error) throw error;
      mine = (data?.[0] as BetRow | undefined) ?? null;
    }
  }

  const settled = round?.phase === "crashed";

  return {
    // Hora de la BD estimada ahora (lo cacheado envejece): el cliente sincroniza su reloj con ella.
    serverNow: view.now_ms + (Date.now() - at),
    points,
    round: round
      ? {
          id: round.id,
          phase: round.phase,
          hash: round.server_seed_hash,
          startsAtMs: round.starts_at_ms,
          growth: round.growth,
          rtp: round.rtp,
          maxMult: round.max_mult,
          publicSeed: CRASH_PUBLIC_SEED,
          ...(settled
            ? {
                point: round.point ?? null,
                serverSeed: round.server_seed ?? null,
                crashAtMs: round.crash_at_ms ?? null,
                nextAtMs: view.next_at_ms,
              }
            : {}),
        }
      : null,
    myBet: mine && round ? betPublic(mine, round.id) : null,
    players: view.players.slice(0, PLAYERS_SHOWN).map((p) => ({
      name: p.name,
      bet: p.bet,
      status: p.status,
      cashout: p.status === "won" ? p.cashout : null,
      payout: p.status === "won" ? p.payout : 0,
      me: p.user_id === userId,
    })),
    playersCount: view.players_count,
    playersTotal: view.players_total,
    // Últimas explosiones (rondas ya liquidadas), con lo necesario para verificarlas.
    history: view.history.map((h) => ({
      id: h.id,
      point: h.point,
      serverSeed: h.server_seed,
      hash: h.server_seed_hash,
      rtp: h.rtp,
      maxMult: h.max_mult,
    })),
    betMs: CRASH_BET_MS,
    pauseMs: CRASH_PAUSE_MS,
  };
}

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

function checkRoundId(roundId: unknown): number {
  if (typeof roundId !== "number" || !Number.isSafeInteger(roundId) || roundId <= 0) {
    throw new GameError("INVALID_REQUEST_BODY", 400);
  }
  return roundId;
}

/**
 * Apuesta en la ronda `roundId` (la que el cliente está viendo), solo durante
 * su fase de apuestas. `autoCashout` es opcional (null = solo manual). El
 * saldo, el +18, el baneo, la ventana de apuestas y el reinicio mensual los
 * comprueba `crash_bet` bajo bloqueo.
 */
export async function placeCrashBet(
  userId: number,
  input: { roundId: unknown; bet: unknown; autoCashout?: unknown; requestId: unknown }
) {
  const cfg = (await getGamesSettings()).crash;

  if (typeof input.requestId !== "string" || !REQUEST_ID.test(input.requestId)) {
    throw new GameError("INVALID_REQUEST_BODY", 400);
  }
  const roundId = checkRoundId(input.roundId);

  const bet = input.bet;
  if (typeof bet !== "number" || !Number.isSafeInteger(bet) || bet < cfg.minBet || bet > cfg.maxBet) {
    throw new GameError("BET_OUT_OF_RANGE", 400, { min: cfg.minBet, max: cfg.maxBet });
  }

  let auto: number | null = null;
  if (input.autoCashout !== undefined && input.autoCashout !== null) {
    if (typeof input.autoCashout !== "number" || !Number.isFinite(input.autoCashout)) {
      throw new GameError("INVALID_TARGET", 400, { min: 1.01, max: cfg.maxMult });
    }
    // El objetivo se normaliza a 2 decimales (igual que el punto de explosión).
    auto = Math.round(input.autoCashout * 100) / 100;
    if (!(auto >= 1.01 && auto <= cfg.maxMult)) {
      throw new GameError("INVALID_TARGET", 400, { min: 1.01, max: cfg.maxMult });
    }
  }

  const row = await rpc<{ bet: BetRow; balance: number }>("crash_bet", {
    p_user_id: userId,
    p_round_id: roundId,
    p_request_id: input.requestId,
    p_bet: bet,
    p_auto: auto,
  });
  dropCache();
  return { bet: betPublic(row.bet, roundId), points: row.balance };
}

/**
 * Retirada manual de MI apuesta: gana al multiplicador de la BD en este
 * instante, o la ronda ya había explotado. La ronda sigue para los demás.
 */
export async function cashoutCrashBet(userId: number, input: { roundId: unknown }) {
  const roundId = checkRoundId(input.roundId);
  const row = await rpc<{ bet: BetRow; balance: number }>("crash_cashout", {
    p_user_id: userId,
    p_round_id: roundId,
  });
  dropCache();
  return { bet: betPublic(row.bet, roundId), points: row.balance };
}
