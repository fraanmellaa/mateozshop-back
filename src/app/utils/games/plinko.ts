import { randomInt } from "crypto";

/** Sortea una casilla con probabilidad proporcional a su peso (enteros ≥ 0). */
export function drawPlinkoSlot(weights: number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = randomInt(0, total);
  for (let i = 0; i < weights.length; i++) {
    if (roll < weights[i]) return i;
    roll -= weights[i];
  }
  return weights.length - 1;
}
