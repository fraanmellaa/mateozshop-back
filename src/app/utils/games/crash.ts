import { randomInt } from "crypto";

/** Estado de una ronda de crash. `crashAt` es secreto mientras esté activa. */
export type CrashState = {
  crashAt: number;
  /** Instante de inicio según el reloj del servidor (ms). */
  startedAtMs: number;
  // Parámetros fijados al empezar: un cambio de ajustes no altera la ronda.
  growthPerTick: number;
  tickMs: number;
  /** Multiplicador con el que se cobró (solo en rondas `cashed_out`). */
  cashoutMultiplier?: number;
};

const floor2 = (x: number) => Math.floor(x * 100) / 100;

/**
 * Punto de crash: houseEdge / (1 − r) con r uniforme en [0, 1), truncado a 2
 * decimales y acotado a [1.00, maxMultiplier].
 *
 * El jugador cobra a m solo si m < crashAt (ver `crashMultiplierAt`, también
 * truncado a 2 decimales), así que P(cobrar a m) = P(crashAt ≥ m + 0,01) =
 * houseEdge / (m + 0,01) y el retorno esperado es m × houseEdge / (m + 0,01),
 * siempre por debajo de houseEdge.
 *
 * Dos diferencias con el crash.js original, las dos para que eso se cumpla:
 *  - El mínimo es 1.00 y no 1.01. Con 1.01 y reloj continuo, cobrar a 1.00x
 *    nada más empezar sería una apuesta sin riesgo. Un crashAt de 1.00 es una
 *    ronda que revienta al instante (probabilidad 1 − houseEdge/1.01 ≈ 4 %).
 *  - Se trunca en vez de redondear.
 *
 * El tope: crashAt nunca pasa de `maxMultiplier`, así que la ronda revienta
 * como muy tarde ahí y nadie puede cobrar a `maxMultiplier` o más.
 */
export function drawCrashPoint(houseEdge: number, maxMultiplier: number): number {
  const r = randomInt(0, 2 ** 47) / 2 ** 47;
  const raw = houseEdge / (1 - r);
  return Math.min(Math.max(floor2(raw), 1), maxMultiplier);
}

/** Multiplicador según el tiempo transcurrido, truncado a 2 decimales. */
export function crashMultiplierAt(
  elapsedMs: number,
  growthPerTick: number,
  tickMs: number
): number {
  return floor2(Math.pow(growthPerTick, Math.max(0, elapsedMs) / tickMs));
}
