import { getSupabaseAdmin } from "@/lib/supabase/admin";

import {
  DEFAULT_ECONOMY_SETTINGS,
  EconomyIssue,
  EconomySettings,
  economyIssues,
  economySettingsSchema,
} from "./schema";

const SETTINGS_KEY = "economy";
const CACHE_TTL_MS = 30_000;

let cache: { value: EconomySettings; expiresAt: number } | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lo guardado manda; los campos que falten (añadidos después) salen de los defaults. */
function mergeWithDefaults(stored: unknown) {
  const source = isRecord(stored) ? stored : {};
  const defaults = DEFAULT_ECONOMY_SETTINGS as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...defaults, ...source };

  for (const key of Object.keys(defaults)) {
    const base = defaults[key];
    const own = source[key];
    // Las secciones con objetos anidados fijos (rain…) se funden un nivel más.
    if (isRecord(base) && isRecord(own)) {
      const merged: Record<string, unknown> = { ...base, ...own };
      for (const inner of Object.keys(base)) {
        const b = base[inner];
        const o = own[inner];
        if (isRecord(b) && isRecord(o)) merged[inner] = { ...b, ...o };
      }
      out[key] = merged;
    }
  }
  return out;
}

/**
 * Ajustes vigentes de la economía (caché en memoria de ~30 s). Si la fila no
 * existe, no se puede leer o no pasa la validación, se usan los valores por
 * defecto del código.
 */
export async function getEconomySettings(): Promise<EconomySettings> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;

  const { data, error } = await getSupabaseAdmin()
    .from("app_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .limit(1);

  if (error) {
    console.error("Error reading economy settings, using defaults:", error);
    return DEFAULT_ECONOMY_SETTINGS;
  }

  const parsed = economySettingsSchema.safeParse(mergeWithDefaults(data?.[0]?.value));
  if (!parsed.success) {
    console.error("Stored economy settings are invalid, using defaults:", economyIssues(parsed.error));
  }

  const value = parsed.success ? parsed.data : DEFAULT_ECONOMY_SETTINGS;
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function saveEconomySettings(
  input: unknown
): Promise<{ ok: true; settings: EconomySettings } | { ok: false; issues: EconomyIssue[] }> {
  const parsed = economySettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: economyIssues(parsed.error) };
  }

  const { error } = await getSupabaseAdmin()
    .from("app_settings")
    .upsert(
      { key: SETTINGS_KEY, value: parsed.data, updated_at: Math.floor(Date.now() / 1000) },
      { onConflict: "key" }
    );
  if (error) throw error;

  cache = { value: parsed.data, expiresAt: Date.now() + CACHE_TTL_MS };
  return { ok: true, settings: parsed.data };
}
