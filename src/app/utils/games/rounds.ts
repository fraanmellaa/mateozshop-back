import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { creditPoints, debitPoints, refundPoints } from "@/app/utils/points";

/**
 * Acceso a `game_rounds` y movimientos de puntos de una ronda. El `state` de
 * una ronda activa es secreto: nunca se devuelve tal cual al cliente.
 */

export type Game = "mines" | "crash" | "plinko";
export type RoundStatus = "active" | "won" | "lost" | "cashed_out" | "abandoned";

export type GameRound<S = unknown> = {
  id: string;
  user_id: number;
  game: Game;
  bet: number;
  status: RoundStatus;
  state: S;
  payout: number;
  version: number;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
};

/** Error de negocio de un juego; la ruta lo devuelve como `{ success: false, error: code }`. */
export class GameError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "GameError";
    this.code = code;
    this.status = status;
  }
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

export function assertValidBet(bet: number, limits: { minBet: number; maxBet: number }) {
  if (!Number.isSafeInteger(bet) || bet < limits.minBet || bet > limits.maxBet) {
    throw new GameError("INVALID_REQUEST_BODY", 400);
  }
}

export async function getBalance(userId: number): Promise<number> {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("total_points, used_points")
    .eq("id", userId)
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  return row ? Number(row.total_points || 0) - Number(row.used_points || 0) : 0;
}

export async function loadRound<S>(roundId: string, userId: number, game: Game) {
  const { data, error } = await getSupabaseAdmin()
    .from("game_rounds")
    .select("*")
    .eq("id", roundId)
    .eq("user_id", userId)
    .eq("game", game)
    .limit(1);
  if (error) throw error;
  if (!data?.[0]) throw new GameError("ROUND_NOT_FOUND", 404);
  return data[0] as GameRound<S>;
}

export async function loadActiveRound<S>(userId: number, game: Game) {
  const { data, error } = await getSupabaseAdmin()
    .from("game_rounds")
    .select("*")
    .eq("user_id", userId)
    .eq("game", game)
    .eq("status", "active")
    .limit(1);
  if (error) throw error;
  return (data?.[0] as GameRound<S> | undefined) ?? null;
}

/**
 * Única forma de cambiar una ronda activa: update condicionado a que siga
 * activa y en la versión leída. Devuelve la fila nueva, o null si otra
 * petición se adelantó (quien llama relee o responde ROUND_NOT_ACTIVE).
 */
export async function transitionRound<S>(
  round: GameRound<S>,
  patch: { status?: RoundStatus; state?: S; payout?: number }
) {
  const now = nowSeconds();
  const finished = patch.status !== undefined && patch.status !== "active";

  const { data, error } = await getSupabaseAdmin()
    .from("game_rounds")
    .update({
      ...patch,
      version: round.version + 1,
      updated_at: now,
      ...(finished ? { finished_at: now } : {}),
    })
    .eq("id", round.id)
    .eq("status", "active")
    .eq("version", round.version)
    .select("*");
  if (error) throw error;
  return (data?.[0] as GameRound<S> | undefined) ?? null;
}

/**
 * Cobra la apuesta y crea la ronda. Primero se cobra; si el insert falla se
 * devuelve la apuesta, de modo que nunca queda una ronda jugable sin cobrar.
 * Devuelve el saldo tras el cobro.
 */
export async function chargeAndCreateRound(
  round: {
    id: string;
    userId: number;
    game: Game;
    bet: number;
    state: unknown;
    status?: RoundStatus;
    payout?: number;
  }
): Promise<number> {
  const ref = { refType: "game_round", refId: round.id };

  const balance = await debitPoints(round.userId, round.bet, {
    kind: `${round.game}_bet`,
    ...ref,
    idempotencyKey: `round:${round.id}:bet`,
  });

  const now = nowSeconds();
  const status = round.status ?? "active";
  const { error } = await getSupabaseAdmin()
    .from("game_rounds")
    .insert({
      id: round.id,
      user_id: round.userId,
      game: round.game,
      bet: round.bet,
      status,
      state: round.state,
      payout: round.payout ?? 0,
      created_at: now,
      updated_at: now,
      finished_at: status === "active" ? null : now,
    });

  if (error) {
    try {
      await refundPoints(round.userId, round.bet, {
        kind: `${round.game}_refund`,
        ...ref,
        idempotencyKey: `round:${round.id}:refund`,
      });
    } catch (refundError) {
      console.error(`Bet of round ${round.id} charged but not refunded:`, refundError);
    }
    // 23505: ya hay otra ronda activa (dos "empezar" a la vez).
    if (error.code === "23505") throw new GameError("ROUND_IN_PROGRESS", 409);
    throw error;
  }

  return balance;
}

/**
 * Abona el premio de una ronda ya finalizada y devuelve el saldo. La clave de
 * idempotencia hace que repetirlo (reintento, doble clic) no pague dos veces.
 */
export async function payRound(
  round: Pick<GameRound, "id" | "user_id" | "game" | "payout">
): Promise<number> {
  if (round.payout <= 0) return getBalance(round.user_id);
  return creditPoints(round.user_id, round.payout, {
    kind: `${round.game}_payout`,
    refType: "game_round",
    refId: round.id,
    idempotencyKey: `round:${round.id}:payout`,
  });
}
