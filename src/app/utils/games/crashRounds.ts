import { randomUUID } from "crypto";

import type { ExtensionSettings } from "@/app/utils/settings/schema";

import { CrashState, crashMultiplierAt, drawCrashPoint } from "./crash";
import {
  GameError,
  GameRound,
  assertValidBet,
  chargeAndCreateRound,
  getBalance,
  loadActiveRound,
  loadRound,
  payRound,
  transitionRound,
} from "./rounds";

type CrashRound = GameRound<CrashState>;

/** Multiplicador actual de una ronda según el reloj del servidor. */
function currentMultiplier(s: CrashState) {
  return crashMultiplierAt(Date.now() - s.startedAtMs, s.growthPerTick, s.tickMs);
}

/**
 * Cierra una ronda activa según el reloj: perdida si el multiplicador ya
 * alcanzó el punto de crash; si no, y `cashout` es true, cobrada al
 * multiplicador actual. Devuelve la ronda cerrada, la misma ronda si sigue
 * activa (cashout false y sin reventar) o null si otra petición se adelantó.
 */
async function settleByClock(
  round: CrashRound,
  cashout: boolean,
  multiplier = currentMultiplier(round.state)
) {
  if (multiplier >= round.state.crashAt) {
    return transitionRound(round, { status: "lost" });
  }
  if (!cashout) return round;

  return transitionRound(round, {
    status: "cashed_out",
    payout: Math.floor(round.bet * multiplier),
    state: { ...round.state, cashoutMultiplier: multiplier },
  });
}

/** Respuesta de una ronda ya cerrada. Solo aquí se revela `crashAt`. */
async function finishedView(round: CrashRound) {
  if (round.status === "cashed_out") {
    return {
      status: "cashed_out",
      multiplier: round.state.cashoutMultiplier,
      payout: round.payout,
      points: await payRound(round),
    };
  }
  return {
    status: "lost",
    crashAt: round.state.crashAt,
    points: await getBalance(round.user_id),
  };
}

export async function startCrash(
  userId: number,
  bet: number,
  cfg: ExtensionSettings["crash"]
) {
  assertValidBet(bet, cfg);

  // Una ronda anterior sin cerrar se liquida como si el jugador hubiera
  // pulsado "cobrar" ahora: perdida si ya reventó, cobrada si no.
  for (let attempt = 0; attempt < 2; attempt++) {
    const previous = await loadActiveRound<CrashState>(userId, "crash");
    if (!previous) break;
    const done = await settleByClock(previous, true);
    if (done) {
      if (done.status === "cashed_out") await payRound(done);
      break;
    }
  }

  const roundId = randomUUID();
  const points = await chargeAndCreateRound({
    id: roundId,
    userId,
    game: "crash",
    bet,
    state: {
      crashAt: drawCrashPoint(cfg.houseEdge, cfg.maxMultiplier),
      startedAtMs: Date.now(),
      growthPerTick: cfg.growthPerTick,
      tickMs: cfg.tickMs,
    } satisfies CrashState,
  });

  return { roundId, points, growthPerTick: cfg.growthPerTick, tickMs: cfg.tickMs };
}

export async function getCrash(userId: number, roundId: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const round = await loadRound<CrashState>(roundId, userId, "crash");
    if (round.status !== "active") return finishedView(round);

    // Si ya reventó se marca perdida ahora (nadie más lo hace).
    const multiplier = currentMultiplier(round.state);
    const settled = await settleByClock(round, false, multiplier);
    if (!settled) continue;
    if (settled.status !== "active") return finishedView(settled);
    return { status: "active", multiplier };
  }

  throw new GameError("ROUND_NOT_ACTIVE", 409);
}

export async function cashoutCrash(userId: number, roundId: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const round = await loadRound<CrashState>(roundId, userId, "crash");
    if (round.status !== "active") return finishedView(round);

    const settled = await settleByClock(round, true);
    if (settled) return finishedView(settled);
  }

  throw new GameError("ROUND_NOT_ACTIVE", 409);
}
