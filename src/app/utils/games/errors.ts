/** Error de negocio de un juego; la ruta lo devuelve como `{ success: false, error: code, ...extra }`. */
export class GameError extends Error {
  code: string;
  status: number;
  extra: Record<string, unknown>;

  constructor(code: string, status: number, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = "GameError";
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

type DbError = { message?: string; code?: string; details?: string | null };

const DB_CODES: Record<string, number> = {
  INSUFFICIENT_POINTS: 400,
  USER_BANNED: 403,
  ADULT_REQUIRED: 403,
  USER_NOT_FOUND: 404,
  INVALID_COUNT: 400,
  INVALID_AMOUNT: 400,
  INVALID_CLIENT_SEED: 400,
  TOURNAMENT_NOT_FOUND: 404,
  TOURNAMENT_NOT_OPEN: 409,
  NOT_ELIGIBLE: 403,
  ENTRY_NOT_FOUND: 404,
  NO_SPINS_LEFT: 409,
  STALE_ENTRY: 409,
  // Crash en vivo
  ROUND_ACTIVE: 409,
  ROUND_NOT_FOUND: 404,
  SEED_CHANGED: 409,
  GAMES_PAUSED: 409,
  INVALID_TARGET: 400,
  DUPLICATE_REQUEST: 409,
  // Crash compartido
  BETS_CLOSED: 409,
  BET_EXISTS: 409,
  BET_NOT_FOUND: 404,
  ROUND_NOT_STARTED: 409,
  INVALID_REQUEST: 400,
  // Buscaminas
  INVALID_MINES: 400,
  INVALID_CELL: 400,
  NOTHING_TO_CASH_OUT: 409,
  CANNOT_CANCEL: 409,
};

/**
 * Traduce un error de una función SQL (`RAISE EXCEPTION 'CODIGO'`) a un
 * GameError. Lo desconocido pasa como Error genérico: solo se registra el
 * mensaje de la BD, nunca los argumentos (que pueden llevar semillas).
 */
export function dbError(error: DbError, fn: string): Error {
  const message = String(error.message || "").trim();
  if (message in DB_CODES) return new GameError(message, DB_CODES[message]);
  // Índice único de nonce (o de la entrada): no debería ocurrir; si ocurre, nada se aplicó.
  if (error.code === "23505") return new GameError("DUPLICATE_ROUND", 409);
  return new Error(`${fn} failed: ${message || "unknown error"}`);
}
