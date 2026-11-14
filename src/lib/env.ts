import { createHash, timingSafeEqual } from "crypto";

/**
 * Lee una variable de entorno obligatoria. Sin valores por defecto: si falta,
 * la petición falla en vez de funcionar con un secreto conocido.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Deriva un secreto de uso único a partir de JWT_SECRET. Así un token firmado
 * para un propósito (p. ej. el `state` de un OAuth) nunca valida como otro
 * (p. ej. la sesión de admin).
 */
export function derivedSecret(purpose: string): string {
  return createHash("sha256")
    .update(`${purpose}:${requireEnv("JWT_SECRET")}`)
    .digest("hex");
}

/** Comparación de secretos en tiempo constante. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
