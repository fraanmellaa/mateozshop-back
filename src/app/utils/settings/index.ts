import { getSupabaseAdmin } from "@/lib/supabase/admin";

import {
  DEFAULT_GAMES_SETTINGS,
  GamesSettings,
  SettingsIssue,
  gamesSettingsSchema,
  settingsIssues,
} from "./schema";

// La clave anterior (`extension`: watch, mines, crash, plinko) se ignora.
const SETTINGS_KEY = "games";
const CACHE_TTL_MS = 30_000;

let cache: { value: GamesSettings; expiresAt: number } | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lo guardado manda; lo que falte (campos añadidos después) sale de los defaults. */
function mergeDeep(base: unknown, stored: unknown): unknown {
  if (!isRecord(base) || !isRecord(stored)) return stored === undefined ? base : stored;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(stored)) {
    out[key] = key in base ? mergeDeep(base[key], stored[key]) : stored[key];
  }
  return out;
}

/**
 * Ajustes vigentes de los juegos (caché en memoria de ~30 s). Si la fila no
 * existe, no se puede leer o no pasa la validación, se usan los valores por
 * defecto del código, que son seguros.
 */
export async function getGamesSettings(): Promise<GamesSettings> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;

  const { data, error } = await getSupabaseAdmin()
    .from("app_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .limit(1);

  if (error) {
    console.error("Error reading games settings, using defaults:", error);
    return DEFAULT_GAMES_SETTINGS;
  }

  const parsed = gamesSettingsSchema.safeParse(
    mergeDeep(DEFAULT_GAMES_SETTINGS, data?.[0]?.value)
  );
  if (!parsed.success) {
    console.error("Stored games settings are invalid, using defaults:", settingsIssues(parsed.error));
  }

  const value = parsed.success ? parsed.data : DEFAULT_GAMES_SETTINGS;
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function saveGamesSettings(
  input: unknown
): Promise<{ ok: true; settings: GamesSettings } | { ok: false; issues: SettingsIssue[] }> {
  const parsed = gamesSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: settingsIssues(parsed.error) };
  }

  const { error } = await getSupabaseAdmin()
    .from("app_settings")
    .upsert(
      {
        key: SETTINGS_KEY,
        value: parsed.data,
        updated_at: Math.floor(Date.now() / 1000),
      },
      { onConflict: "key" }
    );

  if (error) throw error;

  // Otras instancias del servidor verán el cambio cuando caduque su caché.
  cache = { value: parsed.data, expiresAt: Date.now() + CACHE_TTL_MS };
  return { ok: true, settings: parsed.data };
}
