import { z } from "zod";

import { assertAdult } from "@/app/utils/accounts/adult";
import { fairReserve } from "@/app/utils/fair";
import { getGamesSettings } from "@/app/utils/settings";
import type { GamesSettings } from "@/app/utils/settings/schema";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { GameError, dbError } from "./errors";
import {
  MINES_CELLS,
  MINES_DEFAULT,
  MINES_MAX,
  MINES_MIN,
  isValidMines,
  minePositions,
  minesCapCents,
  minesTableCents,
} from "./mines";

/**
 * Partidas de Buscaminas (solo desde la extensión). El razonamiento de por qué
 * no se puede superar el RTP está en `mines.ts`; el SQL, en la migración 0030.
 *
 * Empezar: validar → reservar nonce (`fairReserve`) → calcular en memoria las
 * minas y la tabla → `mines_start` (cobra y guarda la ronda). Destapar,
 * plantarse y cancelar son una sola llamada SQL atómica cada una.
 * Las posiciones de las minas solo viajan de aquí a la base de datos; hacia el
 * cliente salen únicamente con la ronda ya cerrada.
 */

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseAdmin().rpc(fn, args);
  if (error) throw dbError(error, fn);
  return data as T;
}

// Cuerpos de las rutas. La apuesta la valida el motor (devuelve los límites).
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const minesStartBody = z.object({
  bet: z.unknown(),
  mines: z.number().int().min(MINES_MIN).max(MINES_MAX),
  requestId: z.string().regex(REQUEST_ID),
});
export const minesRevealBody = z.object({
  roundId: z.uuid(),
  cell: z.number().int().min(0).max(MINES_CELLS - 1),
});
export const minesRoundBody = z.object({ roundId: z.uuid() });

/** Lo que devuelven las funciones SQL `mines_*` (`cells` solo con la ronda cerrada). */
type MinesRow = {
  id: string;
  status: string;
  bet: number;
  nonce: number;
  server_seed_hash: string;
  client_seed: string;
  balance: number;
  mines: number;
  revealed: number[] | null;
  table: number[] | null;
  cents: number | null;
  next_cents?: number | null;
  payout?: number;
  cells?: number[] | null;
  hit?: number | null;
  mode?: string | null;
  refund?: number | null;
  outcome?: "safe" | "mine" | "repeat" | "finished";
  created?: boolean;
};

const mult = (cents: number | null | undefined) =>
  typeof cents === "number" ? cents / 100 : null;

/**
 * Partida tal y como la ve el cliente. Lista blanca explícita: las minas
 * (`cells`), la casilla que explotó y el pago solo se copian con la ronda ya
 * cerrada.
 */
function minesPublic(row: MinesRow) {
  const active = row.status === "active";
  const status = active
    ? ("active" as const)
    : row.status === "won"
      ? ("won" as const)
      : row.status === "cancelled"
        ? ("cancelled" as const)
        : ("lost" as const);
  const revealed = Array.isArray(row.revealed) ? row.revealed : [];
  return {
    id: row.id,
    status,
    bet: row.bet,
    mines: row.mines,
    cells: MINES_CELLS,
    revealed,
    // Multiplicador con las casillas ya destapadas (null si aún ninguna).
    multiplier: mult(row.cents),
    // Multiplicadores tras 1, 2, … casillas seguras (públicos: nº de minas y RTP).
    table: Array.isArray(row.table) ? row.table.map((c) => c / 100) : [],
    nonce: row.nonce,
    serverSeedHash: row.server_seed_hash,
    clientSeed: row.client_seed,
    ...(active
      ? { nextMultiplier: mult(row.next_cents) }
      : {
          minePositions: Array.isArray(row.cells) ? row.cells : [],
          hit: row.hit ?? null,
          payout: row.payout ?? 0,
          refund: row.refund ?? 0,
          // cashout | max (multiplicador máximo) | cleared (tablero limpio) | bust (mina)
          // | cancel (cancelada sin destapar) | void (cruzó el reinicio mensual)
          mode: row.mode ?? null,
        }),
  };
}

const minesResult = (row: MinesRow) => ({
  round: minesPublic(row),
  points: row.balance,
  ...(row.outcome ? { outcome: row.outcome } : {}),
});

/** Datos públicos del Buscaminas: límites, RTP y la tabla de cada nº de minas. */
export function publicMinesConfig(settings: GamesSettings) {
  const cfg = settings.mines;
  const tables: Record<string, number[]> = {};
  for (let m = MINES_MIN; m <= MINES_MAX; m++) {
    tables[String(m)] = minesTableCents(m, cfg.rtp, cfg.maxMult).map((c) => c / 100);
  }
  return {
    minBet: cfg.minBet,
    maxBet: cfg.maxBet,
    maxMult: cfg.maxMult,
    rtp: cfg.rtp,
    cells: MINES_CELLS,
    minMines: MINES_MIN,
    maxMines: MINES_MAX,
    defaultMines: MINES_DEFAULT,
    // tables[minas][k − 1] = multiplicador tras k casillas seguras.
    tables,
  };
}

/** Partida en curso (sin minas) para retomarla; null si no hay. */
export async function currentMinesRound(userId: number) {
  const row = await rpc<MinesRow | null>("mines_current", { p_user_id: userId, p_round_id: null });
  return row ? minesPublic(row) : null;
}

/** true si hay una partida activa: con ella no se puede rotar (= revelar) la semilla. */
export async function hasActiveMinesRound(userId: number): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("game_rounds")
    .select("id")
    .eq("user_id", userId)
    .eq("game", "mines")
    .eq("status", "active")
    .limit(1);
  if (error) throw error;
  return Boolean(data?.[0]);
}

/** Comprobaciones previas a reservar nonce. `mines_start` las repite bajo bloqueo. */
async function precheck(userId: number, bet: number) {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("id, is_banned, adult_confirmed_at, total_points, used_points")
    .eq("id", userId)
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new GameError("USER_NOT_FOUND", 404);
  if (row.is_banned) throw new GameError("USER_BANNED", 403);
  assertAdult({ adult_confirmed_at: row.adult_confirmed_at ?? null });
  const points = Number(row.total_points || 0) - Number(row.used_points || 0);
  if (points < bet) throw new GameError("INSUFFICIENT_POINTS", 400);
}

/** Empieza una partida: cobra la apuesta y reparte las minas, que se quedan en la base de datos. */
export async function startMinesRound(
  userId: number,
  input: { bet: unknown; mines: number; requestId: string }
) {
  const settings = await getGamesSettings();
  const cfg = settings.mines;

  const { bet, mines, requestId } = input;
  if (typeof bet !== "number" || !Number.isSafeInteger(bet) || bet < cfg.minBet || bet > cfg.maxBet) {
    throw new GameError("BET_OUT_OF_RANGE", 400, { min: cfg.minBet, max: cfg.maxBet });
  }
  if (!isValidMines(mines)) {
    throw new GameError("INVALID_MINES", 400, { min: MINES_MIN, max: MINES_MAX });
  }
  if (!REQUEST_ID.test(requestId)) throw new GameError("INVALID_REQUEST_BODY", 400);

  // Reintento de una petición ya atendida: se devuelve su partida sin gastar nonce.
  const { data: previous, error } = await getSupabaseAdmin()
    .from("game_rounds")
    .select("id")
    .eq("user_id", userId)
    .eq("game", "mines")
    .eq("request_id", `mines:${userId}:${requestId}`)
    .limit(1);
  if (error) throw error;
  if (previous?.[0]) {
    const row = await rpc<MinesRow | null>("mines_current", {
      p_user_id: userId,
      p_round_id: previous[0].id,
    });
    if (row) return minesResult(row);
  }

  // Con una partida en curso no se gasta nonce: hay que retomarla o cerrarla.
  if (await hasActiveMinesRound(userId)) throw new GameError("ROUND_ACTIVE", 409);
  await precheck(userId, bet);

  const reservation = await fairReserve(userId, 1);
  const nonce = reservation.nonce_start;
  // Semilla de cliente y nonce de la reserva: quedan fijados en la ronda.
  const cells = minePositions(reservation.server_seed, reservation.client_seed, nonce, mines);
  const table = minesTableCents(mines, cfg.rtp, cfg.maxMult);

  const row = await rpc<MinesRow>("mines_start", {
    p_user_id: userId,
    p_request_id: requestId,
    p_bet: bet,
    p_mines: mines,
    p_cells: cells,
    p_table: table,
    p_max_cents: minesCapCents(cfg.maxMult),
    p_rtp: cfg.rtp,
    p_max_mult: cfg.maxMult,
    p_server_seed_hash: reservation.server_seed_hash,
    p_client_seed: reservation.client_seed,
    p_nonce: nonce,
  });

  return {
    ...minesResult(row),
    fair: {
      server_seed_hash: reservation.server_seed_hash,
      client_seed: reservation.client_seed,
      nonce: nonce + 1,
    },
  };
}

/** Destapa una casilla: segura (sube el multiplicador) o mina (pierde y se enseñan todas). */
export async function revealMinesCell(userId: number, input: { roundId: string; cell: number }) {
  const row = await rpc<MinesRow>("mines_reveal", {
    p_user_id: userId,
    p_round_id: input.roundId,
    p_cell: input.cell,
  });
  return minesResult(row);
}

/** Plantarse: cobra apuesta × multiplicador actual (una sola vez). */
export async function cashoutMinesRound(userId: number, input: { roundId: string }) {
  const row = await rpc<MinesRow>("mines_cashout", { p_user_id: userId, p_round_id: input.roundId });
  return minesResult(row);
}

/** Cancela una partida sin ninguna casilla destapada y devuelve la apuesta. */
export async function cancelMinesRound(userId: number, input: { roundId: string }) {
  const row = await rpc<MinesRow>("mines_cancel", { p_user_id: userId, p_round_id: input.roundId });
  return minesResult(row);
}
