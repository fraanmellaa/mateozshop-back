import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Aleatoriedad verificable (provably fair). Se ejecuta SIEMPRE en el servidor.
 * Port de `juegos-referencia/rng.js` (mismo algoritmo, mismos resultados).
 *
 * - serverSeed: secreto por usuario. Se publica su hash antes de jugar y la
 *   semilla real al rotarla.
 * - clientSeed: la elige el usuario.
 * - nonce: contador de tiradas con esa pareja de semillas.
 * - cursor: permite sacar varios números independientes de la misma tirada.
 */

export type Nonce = number | bigint | string;

export function newServerSeed(): string {
  return randomBytes(32).toString("hex");
}

export function hashSeed(serverSeed: string): string {
  return createHash("sha256").update(serverSeed).digest("hex");
}

/** HMAC-SHA256 en bytes para (serverSeed, clientSeed, nonce, cursor). */
export function hmacBytes(
  serverSeed: string,
  clientSeed: string,
  nonce: Nonce,
  cursor = 0
): Buffer {
  return createHmac("sha256", serverSeed)
    .update(`${clientSeed}:${String(nonce)}:${cursor}`)
    .digest();
}

/** Número uniforme en [0, 1) con 52 bits de precisión. */
export function uniformAt(
  serverSeed: string,
  clientSeed: string,
  nonce: Nonce,
  cursor = 0
): number {
  const b = hmacBytes(serverSeed, clientSeed, nonce, cursor);
  let x = 0;
  for (let i = 0; i < 6; i++) x = x * 256 + b[i];
  x = x * 16 + (b[6] >> 4);
  return x / 2 ** 52;
}

/** Igual que `uniform` de la referencia (cursor 0). */
export function uniform(serverSeed: string, clientSeed: string, nonce: Nonce): number {
  return uniformAt(serverSeed, clientSeed, nonce, 0);
}

/** Entero en [0, max) a partir de una tirada verificable. Válido para max ≤ 2^32. */
export function intBelow(
  max: number,
  serverSeed: string,
  clientSeed: string,
  nonce: Nonce,
  cursor = 0
): number {
  if (!Number.isInteger(max) || max < 1) throw new Error("max inválido");
  return Math.floor(uniformAt(serverSeed, clientSeed, nonce, cursor) * max);
}

/** Elige un elemento según su `weight` relativo con una tirada verificable. */
export function pickWeightedFair<T extends { weight: number }>(
  items: T[],
  serverSeed: string,
  clientSeed: string,
  nonce: Nonce,
  cursor = 0
): T | null {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (items.length === 0 || total <= 0) return null;
  let roll = uniformAt(serverSeed, clientSeed, nonce, cursor) * total;
  for (const item of items) {
    if (roll < item.weight) return item;
    roll -= item.weight;
  }
  return items[items.length - 1];
}
