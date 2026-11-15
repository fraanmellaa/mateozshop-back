import { getSupabaseAdmin } from "@/lib/supabase/admin";

import {
  DEFAULT_SHOP_SETTINGS,
  SettingsIssue,
  ShopSettings,
  shopSettingsIssues,
  shopSettingsSchema,
} from "./schema";

const SETTINGS_KEY = "shop";
const CACHE_TTL_MS = 30_000;

let cache: { value: ShopSettings; expiresAt: number } | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Ajustes vigentes de la tienda (caché en memoria de ~30 s). Lo guardado manda;
 * lo que falte sale de los defaults. Si la fila no se puede leer o no pasa la
 * validación, se usan los defaults del código, que son seguros.
 */
export async function getShopSettings(): Promise<ShopSettings> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;

  const { data, error } = await getSupabaseAdmin()
    .from("app_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .limit(1);

  if (error) {
    console.error("Error reading shop settings, using defaults:", error);
    return DEFAULT_SHOP_SETTINGS;
  }

  const stored = data?.[0]?.value;
  const parsed = shopSettingsSchema.safeParse({
    ...DEFAULT_SHOP_SETTINGS,
    ...(isRecord(stored) ? stored : {}),
  });
  if (!parsed.success) {
    console.error("Stored shop settings are invalid, using defaults:", shopSettingsIssues(parsed.error));
  }

  const value = parsed.success ? parsed.data : DEFAULT_SHOP_SETTINGS;
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function saveShopSettings(
  input: unknown
): Promise<{ ok: true; settings: ShopSettings } | { ok: false; issues: SettingsIssue[] }> {
  const parsed = shopSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: shopSettingsIssues(parsed.error) };
  }

  const { error } = await getSupabaseAdmin()
    .from("app_settings")
    .upsert(
      { key: SETTINGS_KEY, value: parsed.data, updated_at: Math.floor(Date.now() / 1000) },
      { onConflict: "key" }
    );
  if (error) throw error;

  // Otras instancias del servidor verán el cambio cuando caduque su caché.
  cache = { value: parsed.data, expiresAt: Date.now() + CACHE_TTL_MS };
  return { ok: true, settings: parsed.data };
}
