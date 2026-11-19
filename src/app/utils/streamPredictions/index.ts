import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isResetBlocking } from "@/app/utils/economy/monthly";

import {
  type Answer,
  type CreateStreamPredictionInput,
  DEFAULT_STREAM_PREDICTION_SETTINGS,
  type StreamPredictionKind,
  type StreamPredictionSettings,
  streamPredictionSettingsSchema,
} from "./schema";

/**
 * Predicciones del directo: el admin abre una pregunta, los usuarios votan
 * gratis una vez desde la extensión, el admin cierra la votación y luego pone
 * el resultado. Gana una sola persona (quien acierta o quien más se acerca; en
 * empate, quien votó primero) y cobra puntos normales. Toda la lógica vive en
 * las funciones SQL `stream_prediction_*` (migración 0038).
 *
 * No confundir con `utils/predictions` (los Pronósticos deportivos).
 */

export type StreamPredictionStatus = "open" | "closed" | "resolved" | "cancelled";

/** Fila del listado del panel. */
export type AdminStreamPrediction = {
  id: number;
  question: string;
  kind: StreamPredictionKind;
  options: string[];
  status: StreamPredictionStatus;
  winnerPoints: number;
  streamStartedAt: number;
  resultOption: number | null;
  resultNumber: number | null;
  paidPoints: number;
  createdAt: number;
  closedAt: number | null;
  resolvedAt: number | null;
  votes: number;
  /** Votos de cada opción, en su orden (solo en las de opciones). */
  optionVotes: number[] | null;
  winner: { id: number; username: string | null; number: number | null } | null;
};

/** Lo que ve un usuario en la extensión. */
export type CurrentStreamPrediction = {
  id: number;
  question: string;
  kind: StreamPredictionKind;
  options: string[];
  status: "open" | "closed" | "resolved";
  winnerPoints: number;
  votes: number;
  myVote: { option: number | null; number: number | null } | null;
  result: { option: number | null; number: number | null } | null;
  winner: { name: string; isMe: boolean } | null;
};

/** Errores de negocio (códigos de RAISE EXCEPTION y motivos de las funciones SQL). */
export class StreamPredictionError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "StreamPredictionError";
    this.code = code;
    this.status = status;
  }
}

const SQL_ERRORS: Record<string, number> = {
  INVALID_PREDICTION: 400,
  INVALID_VOTE: 400,
  INVALID_RESULT: 400,
  PREDICTION_NOT_FOUND: 404,
  PREDICTION_CLOSED: 409,
  PREDICTION_NOT_OPEN: 409,
  PREDICTION_NOT_CLOSED: 409,
  PREDICTION_RESOLVED: 409,
  ALREADY_VOTED: 409,
  USER_BANNED: 403,
  USER_NOT_FOUND: 404,
};

/** Mensajes para el panel. */
export const STREAM_PREDICTION_MESSAGES: Record<string, string> = {
  NOT_AVAILABLE: "Falta aplicar la migración 0038 en Supabase.",
  NOT_LIVE: "Solo se puede abrir una predicción con el directo encendido.",
  ALREADY_ACTIVE: "Ya hay una predicción en marcha. Ponle resultado o anúlala antes de abrir otra.",
  LIMIT_REACHED: "Ya se ha llegado al máximo de predicciones de este directo.",
  DISABLED: "Las predicciones están desactivadas (máximo por directo a 0).",
  RESET_IN_PROGRESS: "Hay un reinicio mensual en curso. Pon el resultado cuando termine.",
  INVALID_PREDICTION: "Revisa la pregunta y las opciones.",
  INVALID_RESULT: "El resultado no es válido para esta predicción.",
  PREDICTION_NOT_FOUND: "Esa predicción ya no existe.",
  PREDICTION_NOT_OPEN: "La votación ya no está abierta.",
  PREDICTION_NOT_CLOSED: "Cierra la votación antes de poner el resultado.",
  PREDICTION_RESOLVED: "Esa predicción ya tiene resultado.",
};

/** ¿El error dice que la migración 0038 todavía no está aplicada? */
function isMissingMigration(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = String(error.message || "");
  return (
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    error.code === "42883" ||
    error.code === "42P01" ||
    /could not find the (function|table)/i.test(message) ||
    /(function|relation) .*stream_prediction.* does not exist/i.test(message)
  );
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseAdmin().rpc(fn, args);
  if (error) {
    if (isMissingMigration(error)) throw new StreamPredictionError("NOT_AVAILABLE", 503);
    const message = String(error.message || "").trim();
    if (message in SQL_ERRORS) throw new StreamPredictionError(message, SQL_ERRORS[message]);
    throw new Error(`Stream prediction RPC ${fn} failed: ${message || "unknown error"}`);
  }
  return data as T;
}

// ───────────── ajustes (app_settings, clave "stream_predictions") ─────────────

// La clave "predictions" ya la usan los Pronósticos: esta es otra.
const SETTINGS_KEY = "stream_predictions";

export async function getStreamPredictionSettings(): Promise<StreamPredictionSettings> {
  const { data, error } = await getSupabaseAdmin()
    .from("app_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .limit(1);

  if (error) {
    console.error("Error reading stream prediction settings, using defaults:", error);
    return DEFAULT_STREAM_PREDICTION_SETTINGS;
  }
  const parsed = streamPredictionSettingsSchema.safeParse({
    ...DEFAULT_STREAM_PREDICTION_SETTINGS,
    ...(data?.[0]?.value as object | undefined),
  });
  return parsed.success ? parsed.data : DEFAULT_STREAM_PREDICTION_SETTINGS;
}

/** Guarda los ajustes; null si no son válidos. */
export async function saveStreamPredictionSettings(
  input: unknown
): Promise<StreamPredictionSettings | null> {
  const parsed = streamPredictionSettingsSchema.safeParse(input);
  if (!parsed.success) return null;

  const { error } = await getSupabaseAdmin()
    .from("app_settings")
    .upsert(
      { key: SETTINGS_KEY, value: parsed.data, updated_at: Math.floor(Date.now() / 1000) },
      { onConflict: "key" }
    );
  if (error) throw error;
  return parsed.data;
}

/** Bloque público para las bases legales. */
export async function getPublicStreamPredictionRules() {
  const settings = await getStreamPredictionSettings();
  return { winnerPoints: settings.winnerPoints, maxPerStream: settings.maxPerStream };
}

// ───────────── lecturas ─────────────

const toNumber = (value: unknown): number | null =>
  value === null || value === undefined || value === "" ? null : Number(value);

/**
 * Listado del panel. `available: false` si la migración 0038 no está aplicada
 * (el panel lo avisa en vez de romperse).
 */
export async function listStreamPredictions(): Promise<{
  available: boolean;
  items: AdminStreamPrediction[];
}> {
  try {
    const rows = await rpc<Array<Record<string, unknown>> | null>("stream_prediction_admin_list", {
      p_limit: 30,
    });
    const items = (rows ?? []).map((row) => {
      const winner = row.winner as { id: number; username: string | null; number: unknown } | null;
      return {
        ...(row as unknown as AdminStreamPrediction),
        id: Number(row.id),
        options: Array.isArray(row.options) ? (row.options as string[]) : [],
        resultNumber: toNumber(row.resultNumber),
        votes: Number(row.votes) || 0,
        optionVotes: Array.isArray(row.optionVotes) ? (row.optionVotes as unknown[]).map(Number) : null,
        winner: winner ? { id: winner.id, username: winner.username, number: toNumber(winner.number) } : null,
      };
    });
    return { available: true, items };
  } catch (error) {
    if (error instanceof StreamPredictionError && error.code === "NOT_AVAILABLE") {
      return { available: false, items: [] };
    }
    throw error;
  }
}

/**
 * Predicción que se enseña en la extensión (la que está en marcha o la última
 * resuelta hace poco). null si no hay ninguna o si falta la migración.
 */
export async function getCurrentStreamPrediction(
  userId: number
): Promise<CurrentStreamPrediction | null> {
  let row: Record<string, unknown> | null;
  try {
    row = await rpc<Record<string, unknown> | null>("stream_prediction_current", {
      p_user_id: userId,
    });
  } catch (error) {
    if (error instanceof StreamPredictionError && error.code === "NOT_AVAILABLE") return null;
    throw error;
  }
  if (!row) return null;

  const pick = (value: unknown) => {
    const answer = value as { option: number | null; number: unknown } | null;
    return answer ? { option: answer.option ?? null, number: toNumber(answer.number) } : null;
  };
  return {
    id: Number(row.id),
    question: String(row.question ?? ""),
    kind: row.kind === "number" ? "number" : "options",
    options: Array.isArray(row.options) ? (row.options as unknown[]).map(String) : [],
    status: row.status as CurrentStreamPrediction["status"],
    winnerPoints: Number(row.winnerPoints) || 0,
    votes: Number(row.votes) || 0,
    myVote: pick(row.myVote),
    result: pick(row.result),
    winner: (row.winner as CurrentStreamPrediction["winner"]) ?? null,
  };
}

// ───────────── acciones del admin ─────────────

/** Abre una predicción: solo con directo, con el máximo por directo y sin otra en marcha. */
export async function createStreamPrediction(
  input: CreateStreamPredictionInput,
  admin: string
): Promise<{ id: number }> {
  const settings = await getStreamPredictionSettings();
  if (settings.maxPerStream < 1) throw new StreamPredictionError("DISABLED", 409);

  const result = await rpc<{ ok: boolean; id?: number; reason?: string }>("stream_prediction_create", {
    p_question: input.question,
    p_kind: input.kind,
    p_options: input.kind === "options" ? (input.options ?? []) : null,
    p_winner_points: settings.winnerPoints,
    p_max_per_stream: settings.maxPerStream,
    p_admin: admin,
  });
  if (!result.ok || !result.id) {
    throw new StreamPredictionError(result.reason || "INVALID_PREDICTION", 409);
  }
  return { id: Number(result.id) };
}

export async function closeStreamPrediction(id: number): Promise<void> {
  await rpc("stream_prediction_close", { p_prediction_id: id });
}

export async function cancelStreamPrediction(id: number): Promise<void> {
  await rpc("stream_prediction_cancel", { p_prediction_id: id });
}

/**
 * Pone el resultado y paga al ganador (si lo hay). Repetirlo no paga dos veces.
 * Durante el reinicio mensual no se paga: lo ganado se borraría con los saldos.
 */
export async function resolveStreamPrediction(
  id: number,
  result: Answer
): Promise<{ winnerUserId: number | null; points: number }> {
  if (await isResetBlocking()) throw new StreamPredictionError("RESET_IN_PROGRESS", 409);

  const data = await rpc<{ winnerUserId: number | null; points: number }>("stream_prediction_resolve", {
    p_prediction_id: id,
    p_option: result.option ?? null,
    p_number: result.number ?? null,
  });
  return { winnerUserId: data.winnerUserId ?? null, points: Number(data.points) || 0 };
}

// ───────────── voto (extensión) ─────────────

/** Un voto por persona, gratis y sin cambios. El baneo y el estado los comprueba la función SQL. */
export async function voteStreamPrediction(
  userId: number,
  predictionId: number,
  vote: Answer
): Promise<void> {
  await rpc("stream_prediction_vote", {
    p_prediction_id: predictionId,
    p_user_id: userId,
    p_option: vote.option ?? null,
    p_number: vote.number ?? null,
  });
}
