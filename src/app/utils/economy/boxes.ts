import { uniformAt, type Nonce } from "../fair/rng";

import type { DailyTier } from "./schema";

/**
 * Sorteo de la caja diaria. Funciones puras sobre la aleatoriedad verificable
 * (utils/fair): con las mismas semillas y el mismo nonce el resultado es
 * siempre el mismo, así que cualquiera puede comprobarlo al revelarse la
 * semilla de servidor.
 *
 *  - cursor 0: tramo (en la caja diaria, tirada en puntos básicos 0–9999)
 *  - cursor 1: punto exacto dentro del rango del tramo
 */

export type DailyRoll = {
  tier: DailyTier;
  /** Tirada en puntos básicos (0–9999) que decidió el tramo. */
  basisPoint: number;
  /** Puntos del tramo. */
  points: number;
};

export function rollDailyBox(
  tiers: DailyTier[],
  serverSeed: string,
  clientSeed: string,
  nonce: Nonce
): DailyRoll {
  const total = tiers.reduce((sum, t) => sum + t.weight, 0);
  const basisPoint = Math.floor(uniformAt(serverSeed, clientSeed, nonce, 0) * total);

  let acc = 0;
  let tier = tiers[tiers.length - 1];
  for (const t of tiers) {
    acc += t.weight;
    if (basisPoint < acc) {
      tier = t;
      break;
    }
  }

  const span = tier.pointsMax - tier.pointsMin + 1;
  const points = tier.pointsMin + Math.floor(uniformAt(serverSeed, clientSeed, nonce, 1) * span);
  return { tier, basisPoint, points };
}
