import { uniformAt, type Nonce } from "@/app/utils/fair";

import { RARITIES, type BoxWeights, type PrizeKind, type Rarity } from "./types";

/**
 * Sorteo puro (sin base de datos). Recibe un generador de números uniformes
 * en [0, 1) indexado por `cursor`:
 *   · cursor 0 -> categoría (floor(u * 10000) sobre los pesos de la caja)
 *   · cursor 1 -> premio dentro de la categoría (según `weight`)
 * En producción el generador es `fairUniform` (HMAC con semilla de servidor,
 * semilla de cliente y nonce: verificable). En simulaciones se inyecta otro.
 * Nunca Math.random para un resultado con premio.
 */

export type DrawablePrize = {
  id: number;
  rarity: Rarity;
  kind: PrizeKind;
  weight: number;
};

/** Número uniforme en [0, 1) para el cursor dado de UNA misma tirada. */
export type Uniform = (cursor: number) => number;

/** Generador verificable de una tirada (mismo algoritmo que los juegos). */
export const fairUniform =
  (serverSeed: string, clientSeed: string, nonce: Nonce): Uniform =>
  (cursor) =>
    uniformAt(serverSeed, clientSeed, nonce, cursor);

const WEIGHT_KEYS: Record<Rarity, keyof BoxWeights> = {
  common: "weight_common",
  rare: "weight_rare",
  epic: "weight_epic",
  legendary: "weight_legendary",
};

/** Categoría sorteada según los pesos de la caja (suman 10000). */
export function drawRarity(box: BoxWeights, uniform: Uniform): Rarity | null {
  const total = RARITIES.reduce((sum, r) => sum + Math.max(0, box[WEIGHT_KEYS[r]]), 0);
  if (total <= 0) return null;
  let roll = Math.floor(uniform(0) * total);
  for (const rarity of RARITIES) {
    const weight = Math.max(0, box[WEIGHT_KEYS[rarity]]);
    if (roll < weight) return rarity;
    roll -= weight;
  }
  return null;
}

/** Igual que `pickWeightedFair` de utils/fair, pero con un `Uniform` inyectable. */
export function pickByWeight<T extends { weight: number }>(items: T[], uniform: Uniform, cursor = 1): T | null {
  const total = items.reduce((sum, p) => sum + p.weight, 0);
  if (items.length === 0 || total <= 0) return null;
  let roll = uniform(cursor) * total;
  for (const item of items) {
    if (roll < item.weight) return item;
    roll -= item.weight;
  }
  return items[items.length - 1];
}

/**
 * Sortea el premio. `pool` trae TODOS los premios activos, también los de
 * stock agotado (si salen, la apertura da sus puntos de respaldo). Solo si la
 * categoría sorteada no tiene NINGÚN premio activo se baja a la inferior
 * (legendario -> épico -> raro -> común). Devuelve null si ni la sorteada ni
 * las inferiores tienen premios.
 */
export function drawPrize<T extends DrawablePrize>(box: BoxWeights, pool: T[], uniform: Uniform): T | null {
  const drawn = drawRarity(box, uniform);
  if (!drawn) return null;

  for (let i = RARITIES.indexOf(drawn); i >= 0; i--) {
    const candidates = pool.filter((p) => p.rarity === RARITIES[i] && p.weight > 0);
    if (candidates.length > 0) return pickByWeight(candidates, uniform, 1);
  }
  return null;
}
