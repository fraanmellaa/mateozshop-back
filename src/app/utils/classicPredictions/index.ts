import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isResetBlocking } from "@/app/utils/economy/monthly";

import type {
  ClassicLockMode,
  ClassicSide,
  ClassicTemplateInput,
  CreateClassicPredictionInput,
} from "./schema";

/**
 * Predicciones (Classic): dos opciones, cada usuario pone puntos normales a
 * una y, cuando el admin da el resultado, el bote entero se reparte entre los
 * que acertaron en proporción a lo que puso cada uno. Anular devuelve los
 * puntos. Toda la lógica vive en las funciones SQL `classic_prediction_*`
 * (migración 0042); aquí solo se llaman y se traducen sus errores.
 *
 * La votación se cierra a mano, con temporizador o al acabar el directo. Las
 * plantillas son predicciones de serie que se abren solas en cada directo
 * (`syncClassicPredictions`).
 *
 * No confundir con `utils/streamPredictions` (voto gratis, un ganador) ni con
 * `utils/predictions` (los Pronósticos deportivos).
 */

export type ClassicStatus = "open" | "locked" | "resolved" | "cancelled";

/** Una predicción tal como la devuelven las lecturas SQL. */
export type ClassicPrediction = {
  id: number;
  title: string;
  optionA: string;
  optionB: string;
  lockMode: ClassicLockMode;
  /** Fin de la votación (segundos Unix), solo con temporizador. */
  locksAt: number | null;
  status: ClassicStatus;
  /** ¿Se puede jugar ahora mismo? Ya cuenta el temporizador y si sigue el directo. */
  votable: boolean;
  winner: ClassicSide | null;
  minBet: number;
  maxBet: number;
  /** Puntos puestos a cada opción y cuánta gente. */
  poolA: number;
  poolB: number;
  bettorsA: number;
  bettorsB: number;
  paidTotal: number;
  /** Se devolvió todo: anulada, o resuelta sin nadie en la opción ganadora. */
  refunded: boolean;
  cancelReason: string | null;
  fromTemplate: boolean;
  createdAt: number;
  resolvedAt: number | null;
  cancelledAt: number | null;
};

export type ClassicMyBet = {
  side: ClassicSide;
  amount: number;
  /** Lo cobrado (o devuelto) al terminar. */
  payout: number;
  status: "active" | "won" | "lost" | "refunded";
};

export type UserClassicPrediction = ClassicPrediction & { myBet: ClassicMyBet | null };
export type AdminClassicPrediction = ClassicPrediction & {
  createdBy: string | null;
  closedBy: string | null;
  lockedAt: number | null;
};

export type ClassicTemplate = {
  id: number;
  title: string;
  optionA: string;
  optionB: string;
  minBet: number;
  maxBet: number;
  isActive: boolean;
  sortOrder: number;
};

/** Errores de negocio (códigos de RAISE EXCEPTION y motivos de las funciones SQL). */
export class ClassicPredictionError extends Error {
  code: string;
  status: number;
  extra: Record<string, unknown>;

  constructor(code: string, status: number, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = "ClassicPredictionError";
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const SQL_ERRORS: Record<string, number> = {
  INVALID_PREDICTION: 400,
  INVALID_BET: 400,
  INVALID_RESULT: 400,
  BET_OUT_OF_RANGE: 400,
  TOO_MANY_TEMPLATES: 409,
  TEMPLATE_NOT_FOUND: 404,
  PREDICTION_NOT_FOUND: 404,
  PREDICTION_CLOSED: 409,
  PREDICTION_FINISHED: 409,
  SIDE_LOCKED: 409,
  PAYOUT_TOO_LARGE: 409,
  USER_NOT_FOUND: 404,
  USER_BANNED: 403,
  INSUFFICIENT_POINTS: 409,
};

/** Mensajes para el panel. */
export const CLASSIC_PREDICTION_MESSAGES: Record<string, string> = {
  NOT_AVAILABLE: "Falta aplicar la migración 0042 en Supabase.",
  NOT_LIVE: "Esa opción solo vale con el directo encendido.",
  TOO_MANY_ACTIVE: "Hay demasiadas predicciones en marcha. Da el resultado de alguna o anúlala.",
  TOO_MANY_TEMPLATES: "Ya hay 20 predicciones de serie. Borra alguna antes de crear otra.",
  TEMPLATE_NOT_FOUND: "Esa predicción de serie ya no existe.",
  RESET_IN_PROGRESS: "Hay un reinicio mensual en curso. Vuelve a intentarlo cuando termine.",
  INVALID_PREDICTION: "Revisa la pregunta, las dos opciones y los límites de puntos.",
  INVALID_RESULT: "Elige cuál de las dos opciones ha ganado.",
  PREDICTION_NOT_FOUND: "Esa predicción ya no existe.",
  PREDICTION_FINISHED: "Esa predicción ya está terminada.",
  PAYOUT_TOO_LARGE: "El premio de algún usuario es demasiado grande para pagarlo. Anula la predicción.",
};

/** ¿El error dice que la migración 0042 todavía no está aplicada? */
function isMissingMigration(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = String(error.message || "");
  return (
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    error.code === "42883" ||
    error.code === "42P01" ||
    /could not find the (function|table)/i.test(message) ||
    /(function|relation) .*classic_prediction.* does not exist/i.test(message)
  );
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabaseAdmin().rpc(fn, args);
  if (error) {
    if (isMissingMigration(error)) throw new ClassicPredictionError("NOT_AVAILABLE", 503);
    const message = String(error.message || "").trim();
    if (message in SQL_ERRORS) {
      // BET_OUT_OF_RANGE trae en DETAIL «mínimo:máximo» que aún puede poner.
      const range = message === "BET_OUT_OF_RANGE" ? /^(\d+):(\d+)$/.exec(String(error.details || "")) : null;
      throw new ClassicPredictionError(
        message,
        SQL_ERRORS[message],
        range ? { min: Number(range[1]), max: Number(range[2]) } : {}
      );
    }
    throw new Error(`Classic prediction RPC ${fn} failed: ${message || "unknown error"}`);
  }
  return data as T;
}

const isNotAvailable = (error: unknown) =>
  error instanceof ClassicPredictionError && error.code === "NOT_AVAILABLE";

// ───────────── directo: predicciones de serie ─────────────

/**
 * Abre las predicciones de serie que falten en el directo en curso. Barata y
 * repetible; la llaman la sincronización del directo y las lecturas. Nunca
 * lanza: un fallo aquí no puede tumbar a quien la llama.
 */
export async function syncClassicPredictions(): Promise<number> {
  try {
    return Number(await rpc<number>("classic_prediction_sync")) || 0;
  } catch (error) {
    if (!isNotAvailable(error)) console.error("[CLASSIC] No se pudieron abrir las predicciones de serie:", error);
    return 0;
  }
}

// ───────────── lecturas ─────────────

/** Los botes llegan como bigint: a número. */
function normalize<T extends ClassicPrediction>(row: T): T {
  return {
    ...row,
    id: Number(row.id),
    poolA: Number(row.poolA) || 0,
    poolB: Number(row.poolB) || 0,
    paidTotal: Number(row.paidTotal) || 0,
  };
}

/**
 * Lo que enseña la extensión: las predicciones en marcha y las terminadas hace
 * poco, con la jugada del usuario. `now` es la hora del servidor (para la
 * cuenta atrás). Sin la migración, lista vacía.
 */
export async function listClassicPredictionsForUser(userId: number): Promise<{
  now: number;
  live: boolean;
  items: UserClassicPrediction[];
}> {
  await syncClassicPredictions();
  try {
    const data = await rpc<{ now: number; live: boolean; items: UserClassicPrediction[] }>(
      "classic_prediction_user_list",
      { p_user_id: userId }
    );
    return { now: Number(data.now), live: Boolean(data.live), items: (data.items ?? []).map(normalize) };
  } catch (error) {
    if (isNotAvailable(error)) return { now: Math.floor(Date.now() / 1000), live: false, items: [] };
    throw error;
  }
}

/** Listado del panel. `available: false` si la migración 0042 no está aplicada. */
export async function listClassicPredictionsForAdmin(): Promise<{
  available: boolean;
  now: number;
  live: boolean;
  templates: ClassicTemplate[];
  items: AdminClassicPrediction[];
}> {
  await syncClassicPredictions();
  try {
    const data = await rpc<{
      now: number;
      live: boolean;
      templates: ClassicTemplate[];
      items: AdminClassicPrediction[];
    }>("classic_prediction_admin_list", { p_limit: 40 });
    return {
      available: true,
      now: Number(data.now),
      live: Boolean(data.live),
      templates: (data.templates ?? []).map((t) => ({ ...t, id: Number(t.id) })),
      items: (data.items ?? []).map(normalize),
    };
  } catch (error) {
    if (isNotAvailable(error)) {
      return { available: false, now: Math.floor(Date.now() / 1000), live: false, templates: [], items: [] };
    }
    throw error;
  }
}

// ───────────── plantillas ─────────────

/** Crea (id null) o edita una predicción de serie. */
export async function saveClassicTemplate(id: number | null, input: ClassicTemplateInput): Promise<{ id: number }> {
  const saved = await rpc<number>("classic_prediction_template_save", {
    p_id: id,
    p_title: input.title,
    p_option_a: input.optionA,
    p_option_b: input.optionB,
    p_min_bet: input.minBet,
    p_max_bet: input.maxBet,
    p_is_active: input.isActive,
    p_sort_order: input.sortOrder ?? 0,
  });
  return { id: Number(saved) };
}

/** Borra una predicción de serie. Las ya abiertas a partir de ella siguen su curso. */
export async function deleteClassicTemplate(id: number): Promise<void> {
  const { error } = await getSupabaseAdmin().from("classic_prediction_templates").delete().eq("id", id);
  if (error) {
    if (isMissingMigration(error)) throw new ClassicPredictionError("NOT_AVAILABLE", 503);
    throw error;
  }
}

// ───────────── acciones del admin ─────────────

/** Abre una predicción ahora. */
export async function createClassicPrediction(
  input: CreateClassicPredictionInput,
  admin: string
): Promise<{ id: number }> {
  if (await isResetBlocking()) throw new ClassicPredictionError("RESET_IN_PROGRESS", 409);

  const result = await rpc<{ ok: boolean; id?: number; reason?: string }>("classic_prediction_create", {
    p_title: input.title,
    p_option_a: input.optionA,
    p_option_b: input.optionB,
    p_lock_mode: input.lockMode,
    p_seconds: input.lockMode === "timer" ? (input.seconds ?? null) : null,
    p_min_bet: input.minBet,
    p_max_bet: input.maxBet,
    p_admin: admin,
  });
  if (!result.ok || !result.id) {
    throw new ClassicPredictionError(result.reason || "INVALID_PREDICTION", 409);
  }
  return { id: Number(result.id) };
}

/** Cierra la votación: ya no se puede jugar; queda esperando el resultado. */
export async function lockClassicPrediction(id: number, admin: string): Promise<void> {
  await rpc("classic_prediction_lock", { p_prediction_id: id, p_admin: admin });
}

/** Anula la predicción y devuelve a cada uno lo que puso. */
export async function cancelClassicPrediction(id: number, admin: string): Promise<{ refunded: number }> {
  const data = await rpc<{ refunded: number }>("classic_prediction_cancel", {
    p_prediction_id: id,
    p_admin: admin,
    p_reason: "admin",
  });
  return { refunded: Number(data.refunded) || 0 };
}

/**
 * Da el resultado y reparte el bote entre los que acertaron. Repetirlo no paga
 * dos veces. Durante el reinicio mensual no se paga: lo ganado se borraría.
 */
export async function resolveClassicPrediction(
  id: number,
  winner: ClassicSide,
  admin: string
): Promise<{ winner: ClassicSide | null; paid: number; winners: number; refunded: boolean; cancelled: boolean }> {
  if (await isResetBlocking()) throw new ClassicPredictionError("RESET_IN_PROGRESS", 409);

  const data = await rpc<{
    winner: ClassicSide | null;
    paid: number;
    winners?: number;
    refunded: boolean;
    cancelled?: boolean;
  }>("classic_prediction_resolve", { p_prediction_id: id, p_winner: winner, p_admin: admin });
  return {
    winner: data.winner ?? null,
    paid: Number(data.paid) || 0,
    winners: Number(data.winners) || 0,
    refunded: Boolean(data.refunded),
    cancelled: Boolean(data.cancelled),
  };
}

/**
 * Reinicio mensual: anula todas las que sigan sin resultado y devuelve los
 * puntos ANTES de poner los saldos a cero. Sin la migración no hay nada que anular.
 */
export async function cancelOpenClassicPredictions(reason = "monthly_reset"): Promise<number> {
  try {
    return Number(await rpc<number>("classic_prediction_cancel_all", { p_reason: reason })) || 0;
  } catch (error) {
    if (isNotAvailable(error)) return 0;
    throw error;
  }
}

// ───────────── jugada (extensión) ─────────────

/**
 * Pone puntos a una opción (se descuentan al momento). La primera jugada fija
 * el lado; después solo se puede añadir al mismo. El baneo, el saldo y si la
 * votación sigue abierta los comprueba la función SQL.
 */
export async function betClassicPrediction(
  userId: number,
  input: { predictionId: number; side: ClassicSide; amount: number; requestId: string }
): Promise<{ balance: number }> {
  if (await isResetBlocking()) throw new ClassicPredictionError("GAMES_PAUSED", 409);

  const data = await rpc<{ balance: number }>("classic_prediction_bet", {
    p_user_id: userId,
    p_prediction_id: input.predictionId,
    p_side: input.side,
    p_amount: input.amount,
    p_request_id: input.requestId,
  });
  return { balance: Number(data.balance) || 0 };
}
