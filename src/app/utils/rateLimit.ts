import { NextResponse } from "next/server";

import { isMissingFunction } from "@/app/utils/products/currency";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Límites de frecuencia. Dos capas:
 *
 *  1. En memoria, por instancia del servidor: gratis y sin latencia. En Vercel
 *     hay varias instancias, así que es un freno aproximado, no un tope exacto.
 *  2. En la base de datos (`rate_limit_hit`, migración 0046): el tope real,
 *     compartido por todas las instancias. Se usa en las rutas donde importa
 *     (login del panel, canje de Discord, subida de capturas, pujas, cajas y
 *     tickets). Mientras la migración no esté aplicada no limita nada: la capa
 *     en memoria sigue funcionando y la web se comporta como hasta ahora.
 *
 * Los topes están muy por encima del uso normal de una persona: solo frenan a
 * un script. Si la comprobación falla por lo que sea, se deja pasar (nunca se
 * bloquea a un usuario por un fallo del limitador).
 */
export type RateRule = { max: number; windowSeconds: number };

export const RATE_RULES = {
  /** Intentos de entrar al panel, por IP. */
  adminLogin: { max: 10, windowSeconds: 15 * 60 },
  /** Canjes del código de Discord de la extensión, por IP. */
  extensionLogin: { max: 20, windowSeconds: 10 * 60 },
  /** Capturas de verificación, por usuario (cada una son varias conversiones de imagen). */
  proofUpload: { max: 20, windowSeconds: 10 * 60 },
  /** Pujas, por usuario. */
  bid: { max: 30, windowSeconds: 60 },
  /** Aperturas de caja, por usuario. */
  lootBox: { max: 60, windowSeconds: 60 },
  /** Compras de tickets, por usuario. */
  tickets: { max: 30, windowSeconds: 60 },
  /** Votos y apuestas de predicciones, por usuario. */
  prediction: { max: 30, windowSeconds: 60 },
  /** Jugadas de los minijuegos, por usuario (solo en memoria: van muy seguidas). */
  game: { max: 300, windowSeconds: 60 },
} as const satisfies Record<string, RateRule>;

type Bucket = { start: number; hits: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 20_000;

/** Capa en memoria: true si la petición cabe en el tope. */
export function memoryRateLimit(key: string, rule: RateRule, nowMs: number = Date.now()): boolean {
  const windowMs = rule.windowSeconds * 1000;
  const start = nowMs - (nowMs % windowMs);
  const bucket = buckets.get(key);
  if (!bucket || bucket.start !== start) {
    // Sin crecer sin fin: al llenarse se tiran las ventanas ya pasadas.
    if (buckets.size >= MAX_BUCKETS) {
      for (const [k, b] of buckets) if (b.start !== start) buckets.delete(k);
      if (buckets.size >= MAX_BUCKETS) buckets.clear();
    }
    buckets.set(key, { start, hits: 1 });
    return true;
  }
  bucket.hits += 1;
  return bucket.hits <= rule.max;
}

// Si la función SQL no existe (migración sin aplicar) no se vuelve a preguntar
// en un minuto: así no se paga una consulta fallida en cada petición.
let dbMissingUntil = 0;

/** Las dos capas: true si la petición puede seguir. */
export async function rateLimit(key: string, rule: RateRule): Promise<boolean> {
  if (!memoryRateLimit(key, rule)) return false;
  if (Date.now() < dbMissingUntil) return true;
  try {
    const { data, error } = await getSupabaseAdmin().rpc("rate_limit_hit", {
      p_key: key,
      p_window: rule.windowSeconds,
      p_max: rule.max,
    });
    if (error) {
      if (isMissingFunction(error, "rate_limit_hit")) dbMissingUntil = Date.now() + 60_000;
      else console.error("rate limit check failed:", error.message);
      return true;
    }
    return data !== false;
  } catch (error) {
    console.error("rate limit check failed:", error instanceof Error ? error.message : "unknown error");
    return true;
  }
}

/** Respuesta común al pasarse del tope. */
export function tooManyRequests(rule: RateRule) {
  return NextResponse.json(
    { success: false, error: "RATE_LIMITED" },
    { status: 429, headers: { "Retry-After": String(rule.windowSeconds) } }
  );
}

/**
 * IP de quien llama DIRECTAMENTE al back (panel, extensión). En Vercel la pone
 * la plataforma y no se puede falsear; fuera, la del proxy que haya delante.
 */
export function directIp(headers: Headers): string {
  const forwarded =
    headers.get("x-vercel-forwarded-for") ?? headers.get("x-real-ip") ?? headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0].trim().slice(0, 64) || "unknown";
}
