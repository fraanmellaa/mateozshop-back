import { randomInt } from "node:crypto";

import { RARITIES, type BoxWeights, type PrizeKind, type Rarity } from "./types";

/**
 * Sorteo puro (sin base de datos). El generador se inyecta para poder
 * simularlo en pruebas; en producción es siempre crypto.randomInt.
 * Nunca usar Math.random.
 */

export type DrawablePrize = {
  id: number;
  rarity: Rarity;
  kind: PrizeKind;
  weight: number;
};

/** Devuelve un entero uniforme en [0, maxExclusive). */
export type RandomInt = (maxExclusive: number) => number;

export const cryptoRandomInt: RandomInt = (max) => randomInt(0, max);

const WEIGHT_KEYS: Record<Rarity, keyof BoxWeights> = {
  common: "weight_common",
  rare: "weight_rare",
  epic: "weight_epic",
  legendary: "weight_legendary",
};

/** Categoría sorteada según los pesos de la caja (suman 10000). */
export function drawRarity(box: BoxWeights, rand: RandomInt = cryptoRandomInt): Rarity | null {
  const total = RARITIES.reduce((sum, r) => sum + Math.max(0, box[WEIGHT_KEYS[r]]), 0);
  if (total <= 0) return null;
  let roll = rand(total);
  for (const rarity of RARITIES) {
    const weight = Math.max(0, box[WEIGHT_KEYS[rarity]]);
    if (roll < weight) return rarity;
    roll -= weight;
  }
  return null;
}

/** Elemento de una lista según su `weight` relativo. */
export function pickByWeight<T extends { weight: number }>(
  items: T[],
  rand: RandomInt = cryptoRandomInt
): T | null {
  const total = items.reduce((sum, p) => sum + p.weight, 0);
  if (items.length === 0 || total <= 0) return null;
  let roll = rand(total);
  for (const item of items) {
    if (roll < item.weight) return item;
    roll -= item.weight;
  }
  return items[items.length - 1];
}

/**
 * Sortea el premio. `available` debe traer solo premios activos y con stock.
 * Si la categoría sorteada no tiene premios disponibles se baja a la
 * siguiente categoría inferior (legendario -> épico -> raro -> común).
 * Devuelve null si ni la categoría sorteada ni las inferiores tienen premios.
 */
export function drawPrize<T extends DrawablePrize>(
  box: BoxWeights,
  available: T[],
  rand: RandomInt = cryptoRandomInt
): T | null {
  const drawn = drawRarity(box, rand);
  if (!drawn) return null;

  for (let i = RARITIES.indexOf(drawn); i >= 0; i--) {
    const candidates = available.filter((p) => p.rarity === RARITIES[i] && p.weight > 0);
    if (candidates.length > 0) return pickByWeight(candidates, rand);
  }
  return null;
}
