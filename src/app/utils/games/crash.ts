import { uniformAt } from "../fair/rng";

/**
 * CRASH con RTP fijo. Port de `juegos-referencia/crash.js`.
 *
 * punto = rtp / (1 − u), u uniforme en [0, 1): la probabilidad de llegar al
 * menos a x es rtp / x, así que retirando en x se gana x con probabilidad
 * rtp / x → ganancia esperada = rtp para CUALQUIER objetivo. El punto se
 * redondea hacia abajo a 2 decimales y por debajo de 1.00 explota al instante;
 * ambos detalles solo favorecen a la casa.
 */

export type CrashConfig = { rtp: number; maxMult: number };

export function crashPoint(
  serverSeed: string,
  clientSeed: string,
  nonce: number | bigint | string,
  cfg: CrashConfig
): number {
  const u = uniformAt(serverSeed, clientSeed, nonce, 0);
  let p = cfg.rtp / (1 - u);
  p = Math.floor(p * 100) / 100;
  if (p < 1) p = 1.0;
  if (p > cfg.maxMult) p = cfg.maxMult;
  return p;
}

/** `target` (retirada automática) debe estar entre 1.01 y `maxMult`. */
export function playCrash(
  input: {
    bet: number;
    target: number;
    serverSeed: string;
    clientSeed: string;
    nonce: number | bigint | string;
  },
  cfg: CrashConfig
) {
  if (!(input.target >= 1.01 && input.target <= cfg.maxMult)) {
    throw new Error("Objetivo fuera de límites");
  }
  const point = crashPoint(input.serverSeed, input.clientSeed, input.nonce, cfg);
  const win = point >= input.target && point > 1.0;
  return { point, win, payout: win ? Math.floor(input.bet * input.target) : 0 };
}
