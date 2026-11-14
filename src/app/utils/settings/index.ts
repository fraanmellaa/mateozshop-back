import { getSupabaseAdmin } from "@/lib/supabase/admin";

import {
  DEFAULT_EXTENSION_SETTINGS,
  ExtensionSettings,
  SettingsIssue,
  extensionSettingsSchema,
  settingsIssues,
} from "./schema";

const SETTINGS_KEY = "extension";
const CACHE_TTL_MS = 30_000;

let cache: { value: ExtensionSettings; expiresAt: number } | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lo guardado manda; lo que falte (campos añadidos después) sale de los defaults. */
function mergeWithDefaults(stored: unknown) {
  const source = isRecord(stored) ? stored : {};
  const section = (name: keyof ExtensionSettings) => ({
    ...DEFAULT_EXTENSION_SETTINGS[name],
    ...(isRecord(source[name]) ? source[name] : {}),
  });

  return {
    watch: section("watch"),
    mines: section("mines"),
    crash: section("crash"),
    plinko: section("plinko"),
  };
}

/**
 * Ajustes vigentes de la extensión (caché en memoria de ~30 s). Si la fila no
 * existe, no se puede leer o no pasa la validación, se usan los valores por
 * defecto del código, que son seguros.
 */
export async function getExtensionSettings(): Promise<ExtensionSettings> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;

  const { data, error } = await getSupabaseAdmin()
    .from("app_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .limit(1);

  if (error) {
    console.error("Error reading extension settings, using defaults:", error);
    return DEFAULT_EXTENSION_SETTINGS;
  }

  const parsed = extensionSettingsSchema.safeParse(mergeWithDefaults(data?.[0]?.value));
  if (!parsed.success) {
    console.error(
      "Stored extension settings are invalid, using defaults:",
      settingsIssues(parsed.error)
    );
  }

  const value = parsed.success ? parsed.data : DEFAULT_EXTENSION_SETTINGS;
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function saveExtensionSettings(
  input: unknown
): Promise<{ ok: true; settings: ExtensionSettings } | { ok: false; issues: SettingsIssue[] }> {
  const parsed = extensionSettingsSchema.safeParse(input);
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
