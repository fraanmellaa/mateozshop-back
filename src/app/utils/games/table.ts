/**
 * Tablas del Plinko (puro: sin BD ni `crypto`, lo usa también el panel).
 * Port de `juegos-referencia/plinko.js`: 16 filas, probabilidad de la casilla
 * k = C(16, k) / 2^16, RTP = Σ prob(k) × mult(k).
 */

export const ROWS = 16;
export const SLOTS = ROWS + 1;
/** Casillas de borde configurables por nivel (de fuera hacia dentro; la tabla es simétrica). */
export const OUTER_LEN = 6;

export const PLINKO_LEVEL_IDS = ["facil", "medio", "hard", "extreme"] as const;
export type PlinkoLevelId = (typeof PLINKO_LEVEL_IDS)[number];

function binom(n: number, k: number) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

export const PROBS: number[] = Array.from(
  { length: SLOTS },
  (_, k) => binom(ROWS, k) / 2 ** ROWS
);

export function rtpOf(table: number[]): number {
  return table.reduce((sum, m, k) => sum + m * PROBS[k], 0);
}

/**
 * Tabla de 17 casillas: los bordes vienen dados y el centro (casillas 6..10)
 * se calcula para que el RTP no pase de `rtp`; se redondea hacia abajo (a
 * favor de la casa). Si los bordes por sí solos ya superan `rtp`, el centro
 * queda en 0 y el RTP real sigue por encima: el esquema de ajustes lo rechaza.
 */
export function buildTable(outer: number[], rtp: number): number[] {
  const make = (mid: number) => [
    ...outer,
    mid,
    mid,
    mid,
    mid,
    mid,
    ...[...outer].reverse(),
  ];
  let lo = 0;
  let hi = 10;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (rtpOf(make(mid)) > rtp) hi = mid;
    else lo = mid;
  }
  return make(Math.floor(lo * 100) / 100);
}
