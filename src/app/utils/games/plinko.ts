import { hmacBytes } from "../fair/rng";

import { ROWS } from "./table";

export { ROWS, PROBS, buildTable, rtpOf } from "./table";

/** Camino de la bola: 16 bits del HMAC (1 = derecha). Port de `dropBall`. */
export function dropBall(serverSeed: string, clientSeed: string, nonce: number | bigint | string) {
  const b = hmacBytes(serverSeed, clientSeed, nonce);
  const path: (0 | 1)[] = [];
  for (let i = 0; i < ROWS; i++) path.push(((b[i >> 3] >> (7 - (i & 7))) & 1) as 0 | 1);
  const slot = path.reduce<number>((a, x) => a + x, 0);
  return { path, slot };
}

export function playBall(input: {
  bet: number;
  table: number[];
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}) {
  const { path, slot } = dropBall(input.serverSeed, input.clientSeed, input.nonce);
  const mult = input.table[slot];
  return { path, slot, mult, payout: Math.floor(input.bet * mult) };
}

/**
 * Varias bolas (turbo / autoplay): cada una usa su propio nonce, empezando en
 * `nonceStart`. Quien llama comprueba ANTES saldo, tope diario y `maxBalls`.
 */
export function playMany(input: {
  bet: number;
  table: number[];
  count: number;
  serverSeed: string;
  clientSeed: string;
  nonceStart: number;
  maxBalls: number;
}) {
  if (!(Number.isInteger(input.count) && input.count >= 1 && input.count <= input.maxBalls)) {
    throw new Error("Número de bolas no válido");
  }
  const balls = [];
  let totalPayout = 0;
  for (let i = 0; i < input.count; i++) {
    const r = playBall({
      bet: input.bet,
      table: input.table,
      serverSeed: input.serverSeed,
      clientSeed: input.clientSeed,
      nonce: input.nonceStart + i,
    });
    balls.push(r);
    totalPayout += r.payout;
  }
  return { balls, totalBet: input.bet * input.count, totalPayout, nextNonce: input.nonceStart + input.count };
}
