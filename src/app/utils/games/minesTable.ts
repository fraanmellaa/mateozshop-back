/**
 * Multiplicadores del Buscaminas (puro: sin BD ni `crypto`, lo usa también el
 * panel). Tablero de 25 casillas con `m` minas: la probabilidad de destapar k
 * seguras seguidas es P(k) = C(25−m, k) / C(25, k), así que el multiplicador
 * justo es 1 / P(k) y el que se paga es
 *
 *   mult(k) = RTP × C(25, k) / C(25−m, k), truncado a 2 decimales hacia abajo
 *
 * y limitado al multiplicador máximo. Se trabaja en céntimos (enteros) y con
 * aritmética exacta: todos los productos caben en un entero seguro de JS.
 */

export const MINES_CELLS = 25;
export const MINES_MIN = 1;
export const MINES_MAX = MINES_CELLS - 1;
export const MINES_DEFAULT = 3;

/** C(n, k) exacto (n ≤ 25: como mucho 5.200.300). */
function binom(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** floor(num / den) exacto para enteros seguros (corrige el redondeo de la división en coma flotante). */
function floorDiv(num: number, den: number): number {
  let q = Math.floor(num / den);
  while (q * den > num) q--;
  while ((q + 1) * den <= num) q++;
  return q;
}

/** RTP en millonésimas, nunca por encima del configurado. */
function rtpPpm(rtp: number): number {
  return Math.floor(rtp * 1_000_000 + 1e-3);
}

/** Multiplicador máximo en céntimos. */
export function minesCapCents(maxMult: number): number {
  return Math.floor(maxMult * 100 + 1e-6);
}

export function isValidMines(mines: unknown): mines is number {
  return typeof mines === "number" && Number.isInteger(mines) && mines >= MINES_MIN && mines <= MINES_MAX;
}

/** Probabilidad de destapar k casillas seguras seguidas con `mines` minas. */
export function minesSurvival(mines: number, k: number): number {
  return binom(MINES_CELLS - mines, k) / binom(MINES_CELLS, k);
}

/**
 * Tabla de una partida: posición k−1 = multiplicador en céntimos tras k
 * casillas seguras (k = 1 … 25−mines). No decrece y nunca pasa del tope.
 */
export function minesTableCents(mines: number, rtp: number, maxMult: number): number[] {
  if (!isValidMines(mines)) throw new Error("Número de minas no válido");
  const ppm = rtpPpm(rtp);
  const cap = minesCapCents(maxMult);
  const safe = MINES_CELLS - mines;
  const table: number[] = [];
  for (let k = 1; k <= safe; k++) {
    // floor(100 × ppm × C(25,k) / (10^6 × C(25−m,k))): numerador < 5,2·10^14.
    const cents = floorDiv(ppm * binom(MINES_CELLS, k) * 100, binom(safe, k) * 1_000_000);
    table.push(Math.min(cents, cap));
  }
  return table;
}

/**
 * Nº de casillas seguras con el que la partida se cobra sola: la primera que
 * alcanza el multiplicador máximo o, si ninguna, el tablero limpio.
 */
export function minesAutoCashoutAt(table: number[], capCents: number): number {
  const i = table.findIndex((c) => c >= capCents);
  return i >= 0 ? i + 1 : table.length;
}

/** RTP real más alto de la tabla (plantarse en el mejor k): siempre ≤ rtp. */
export function minesRealRtp(mines: number, table: number[]): number {
  let best = 0;
  table.forEach((cents, i) => {
    best = Math.max(best, (minesSurvival(mines, i + 1) * cents) / 100);
  });
  return best;
}

/** Pago entero de una apuesta: floor(apuesta × céntimos / 100). Igual que en el SQL. */
export function minesPayout(bet: number, cents: number): number {
  return floorDiv(bet * cents, 100);
}
