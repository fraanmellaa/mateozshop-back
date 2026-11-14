import { randomInt } from "crypto";

/** Estado de una ronda de minas. `mineCells` es secreto mientras esté activa. */
export type MinesState = {
  size: number;
  mines: number;
  /** Índices de celda (row × size + col) con mina. */
  mineCells: number[];
  /** Índices de las celdas seguras ya descubiertas, en orden. */
  revealed: number[];
  // Parámetros fijados al empezar: un cambio de ajustes no altera la ronda.
  houseEdge: number;
  maxMultiplier: number;
};

/** Máximo de minas de un tablero; siempre queda al menos una celda segura. */
export function maxMinesFor(size: number, maxMinePercent: number): number {
  const n = size * size;
  return Math.min(Math.floor(n * maxMinePercent), n - 1);
}

/** Sortea `mines` celdas distintas de forma uniforme (Fisher-Yates parcial). */
export function placeMines(size: number, mines: number): number[] {
  const cells = Array.from({ length: size * size }, (_, i) => i);
  for (let i = 0; i < mines; i++) {
    const j = randomInt(i, cells.length);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, mines);
}

/**
 * mult(k) = houseEdge × ∏_{i=0..k-1} (n−i)/(s−i), con n celdas y s seguras,
 * redondeado a 2 decimales y limitado a `maxMultiplier`.
 *
 * La probabilidad de descubrir k seguras seguidas es ∏ (s−i)/(n−i), justo el
 * inverso del producto: cobrar en cualquier k tiene retorno esperado
 * houseEdge (± 0,005 por el redondeo; menos si actúa el tope).
 */
export function minesMultiplier(
  size: number,
  mines: number,
  k: number,
  houseEdge: number,
  maxMultiplier: number
): number {
  const n = size * size;
  const s = n - mines;
  let m = houseEdge;
  for (let i = 0; i < k && i < s; i++) {
    m *= (n - i) / (s - i);
    if (m >= maxMultiplier) return maxMultiplier;
  }
  return Math.min(Math.round(m * 100) / 100, maxMultiplier);
}

export function cellsToCoords(cells: number[], size: number): [number, number][] {
  return cells.map((cell) => [Math.floor(cell / size), cell % size]);
}
