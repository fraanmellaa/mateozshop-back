import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Reglas anti-farmeo del contrato (sección 7). Se leen de `economy.antiFarm` en
// app_settings (las edita el panel de economía de W1b); si no existen, valen
// estos defaults. La lectura está aislada aquí: si W1b expone un getter de
// ajustes, basta cambiar `loadAntiFarm`.
export const DEFAULT_ANTI_FARM = {
  minLength: 3,
  minDistinctChars: 2,
  repeatWindowSeconds: 60,
  minGapSeconds: 15,
} as const;

export type AntiFarmSettings = { [K in keyof typeof DEFAULT_ANTI_FARM]: number };

const num = (min: number, max: number) => z.number().int().min(min).max(max);

const schema = z.object({
  minLength: num(1, 50),
  minDistinctChars: num(1, 20),
  repeatWindowSeconds: num(0, 3600),
  minGapSeconds: num(0, 3600),
});

const CACHE_TTL_MS = 30_000;
let cache: { value: AntiFarmSettings; expiresAt: number } | null = null;

async function loadAntiFarm(): Promise<unknown> {
  const { data, error } = await getSupabaseAdmin()
    .from("app_settings")
    .select("value")
    .eq("key", "economy")
    .limit(1);
  if (error) throw error;
  const value = data?.[0]?.value;
  return value && typeof value === "object" ? (value as Record<string, unknown>).antiFarm : undefined;
}

export async function getAntiFarmSettings(): Promise<AntiFarmSettings> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;

  let value: AntiFarmSettings = { ...DEFAULT_ANTI_FARM };
  try {
    const stored = await loadAntiFarm();
    const merged = {
      ...DEFAULT_ANTI_FARM,
      ...(stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {}),
    };
    const parsed = schema.safeParse(merged);
    if (parsed.success) value = parsed.data;
    else console.error("Invalid economy.antiFarm settings, using defaults");
  } catch (error) {
    console.error("Error reading anti-farm settings, using defaults:", error);
  }

  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}
