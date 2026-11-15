import { getSupabaseAdmin } from "@/lib/supabase/admin";

import {
  DEFAULT_PREDICTION_SETTINGS,
  PredictionSettings,
  predictionSettingsSchema,
} from "./schema";

export interface PublicPrediction {
  id: number;
  title: string;
  body: string;
  sport: string | null;
  league: string | null;
  pick: string | null;
  odds: number | null;
  event_at: number | null;
  published_at: number | null;
  source: "admin" | "telegram";
}

export interface Prediction extends PublicPrediction {
  is_published: boolean;
  telegram_message_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface PredictionInput {
  title: string;
  body?: string;
  sport?: string | null;
  league?: string | null;
  pick?: string | null;
  odds?: number | null;
  event_at?: number | null;
  is_published?: boolean;
}

export const PREDICTIONS_PAGE_SIZE = 20;

const PUBLIC_COLUMNS =
  "id, title, body, sport, league, pick, odds, event_at, published_at, source";
const ADMIN_COLUMNS = `${PUBLIC_COLUMNS}, is_published, telegram_message_id, created_at, updated_at`;

const nowSeconds = () => Math.floor(Date.now() / 1000);

type Row = Omit<Prediction, "odds"> & { odds: number | string | null };
const normalize = (row: Row): Prediction => ({
  ...row,
  odds: row.odds === null ? null : Number(row.odds),
});

/** Pronósticos publicados, más recientes primero. page empieza en 1. */
export async function getPublishedPredictions(page: number) {
  const from = (page - 1) * PREDICTIONS_PAGE_SIZE;
  const { data, error, count } = await getSupabaseAdmin()
    .from("predictions")
    .select(PUBLIC_COLUMNS, { count: "exact" })
    .eq("is_published", true)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PREDICTIONS_PAGE_SIZE - 1);

  if (error) throw error;
  const result = ((data ?? []) as unknown as Row[]).map(normalize);
  const total = count ?? result.length;
  return {
    result: result as PublicPrediction[],
    page,
    pageSize: PREDICTIONS_PAGE_SIZE,
    total,
    hasMore: from + result.length < total,
  };
}

export async function getAllPredictions(): Promise<Prediction[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("predictions")
    .select(ADMIN_COLUMNS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(500);

  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(normalize);
}

export async function createPrediction(input: PredictionInput): Promise<Prediction> {
  const now = nowSeconds();
  const published = input.is_published ?? false;
  const { data, error } = await getSupabaseAdmin()
    .from("predictions")
    .insert({
      title: input.title,
      body: input.body ?? "",
      sport: input.sport ?? null,
      league: input.league ?? null,
      pick: input.pick ?? null,
      odds: input.odds ?? null,
      event_at: input.event_at ?? null,
      is_published: published,
      published_at: published ? now : null,
      source: "admin",
      created_at: now,
      updated_at: now,
    })
    .select(ADMIN_COLUMNS)
    .single();

  if (error) throw error;
  return normalize(data as unknown as Row);
}

/** Actualización parcial. Devuelve null si no existe. */
export async function updatePrediction(
  id: number,
  input: Partial<PredictionInput>
): Promise<Prediction | null> {
  const now = nowSeconds();
  const patch: Record<string, unknown> = { updated_at: now };
  for (const key of ["title", "body", "sport", "league", "pick", "odds", "event_at"] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }

  if (input.is_published !== undefined) {
    patch.is_published = input.is_published;
    if (input.is_published) {
      const { data: current, error: readError } = await getSupabaseAdmin()
        .from("predictions")
        .select("published_at")
        .eq("id", id)
        .maybeSingle();
      if (readError) throw readError;
      if (!current) return null;
      if (current.published_at === null) patch.published_at = now;
    }
  }

  const { data, error } = await getSupabaseAdmin()
    .from("predictions")
    .update(patch)
    .eq("id", id)
    .select(ADMIN_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data ? normalize(data as unknown as Row) : null;
}

export async function deletePrediction(id: number): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("predictions")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}

// ───────────── ajustes (app_settings, clave "predictions") ─────────────

const SETTINGS_KEY = "predictions";

export async function getPredictionSettings(): Promise<PredictionSettings> {
  const { data, error } = await getSupabaseAdmin()
    .from("app_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .limit(1);

  if (error) {
    console.error("Error reading prediction settings, using defaults:", error);
    return DEFAULT_PREDICTION_SETTINGS;
  }
  const parsed = predictionSettingsSchema.safeParse({
    ...DEFAULT_PREDICTION_SETTINGS,
    ...(data?.[0]?.value as object | undefined),
  });
  return parsed.success ? parsed.data : DEFAULT_PREDICTION_SETTINGS;
}

export async function savePredictionSettings(
  input: unknown
): Promise<PredictionSettings | null> {
  const parsed = predictionSettingsSchema.safeParse(input);
  if (!parsed.success) return null;

  const { error } = await getSupabaseAdmin()
    .from("app_settings")
    .upsert(
      { key: SETTINGS_KEY, value: parsed.data, updated_at: nowSeconds() },
      { onConflict: "key" }
    );
  if (error) throw error;
  return parsed.data;
}

// ───────────── Telegram ─────────────

export interface TelegramPostInput {
  messageId: number;
  text: string;
  /** Fecha del mensaje original (segundos Unix). */
  date: number;
}

/** Título = primera línea no vacía del mensaje (máx. 200 caracteres). */
export function titleFromText(text: string): string {
  const first = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const title = first.trim();
  return title.length > 200 ? `${title.slice(0, 197)}...` : title;
}

/** Un mensaje nuevo del canal. Si ya existe (reintento de Telegram) no hace nada. */
export async function createFromTelegram(input: TelegramPostInput): Promise<"created" | "duplicate"> {
  const settings = await getPredictionSettings();
  const now = nowSeconds();
  const published = settings.autoPublishTelegram;
  const { error } = await getSupabaseAdmin()
    .from("predictions")
    .insert({
      title: titleFromText(input.text),
      body: input.text,
      is_published: published,
      published_at: published ? input.date : null,
      source: "telegram",
      telegram_message_id: input.messageId,
      created_at: now,
      updated_at: now,
    });

  if (error) {
    if (error.code === "23505") return "duplicate";
    throw error;
  }
  return "created";
}

/** Edición de un mensaje del canal: actualiza título y texto; si no lo teníamos, lo crea. */
export async function updateFromTelegram(input: TelegramPostInput): Promise<"updated" | "created" | "duplicate"> {
  const { data, error } = await getSupabaseAdmin()
    .from("predictions")
    .update({
      title: titleFromText(input.text),
      body: input.text,
      updated_at: nowSeconds(),
    })
    .eq("telegram_message_id", input.messageId)
    .select("id");

  if (error) throw error;
  if ((data ?? []).length > 0) return "updated";
  return createFromTelegram(input);
}
