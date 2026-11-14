import { randomUUID } from "crypto";

import type { ExtensionSettings } from "@/app/utils/settings/schema";

import { MinesState, cellsToCoords, maxMinesFor, minesMultiplier, placeMines } from "./mines";
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

type MinesRound = GameRound<MinesState>;

const multAt = (s: MinesState, k: number) =>
  minesMultiplier(s.size, s.mines, k, s.houseEdge, s.maxMultiplier);

const safeCellsOf = (s: MinesState) => s.size * s.size - s.mines;

/** Lo que el jugador puede saber de una ronda en curso con k celdas descubiertas. */
function progress(bet: number, s: MinesState, k: number) {
  const safeCells = safeCellsOf(s);
  const multiplier = k === 0 ? 1 : multAt(s, k);
  return {
    k,
    multiplier,
    payout: k === 0 ? 0 : Math.floor(bet * multiplier),
    nextMultiplier: k < safeCells ? multAt(s, k + 1) : null,
  };
}

/**
 * Cierra la ronda que quedara abierta antes de empezar otra: se cobra si ya
 * había descubierto alguna celda y se da por perdida si no.
 */
async function settlePreviousRound(userId: number) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const round = await loadActiveRound<MinesState>(userId, "mines");
    if (!round) return;

    const k = round.state.revealed.length;
    if (k === 0) {
      if (await transitionRound(round, { status: "abandoned" })) return;
      continue;
    }

    const done = await transitionRound(round, {
      status: "cashed_out",
      payout: Math.floor(round.bet * multAt(round.state, k)),
    });
    if (done) {
      await payRound(done);
      return;
    }
  }
}

export async function startMines(
  userId: number,
  input: { bet: number; size: number; mines: number },
  cfg: ExtensionSettings["mines"]
) {
  const { bet, size, mines } = input;
  assertValidBet(bet, cfg);
  if (
    !cfg.boardSizes.includes(size) ||
    !Number.isInteger(mines) ||
    mines < 1 ||
    mines > maxMinesFor(size, cfg.maxMinePercent)
  ) {
    throw new GameError("INVALID_REQUEST_BODY", 400);
  }

  await settlePreviousRound(userId);

  const state: MinesState = {
    size,
    mines,
    mineCells: placeMines(size, mines),
    revealed: [],
    houseEdge: cfg.houseEdge,
    maxMultiplier: cfg.maxMultiplier,
  };
  const roundId = randomUUID();
  const points = await chargeAndCreateRound({ id: roundId, userId, game: "mines", bet, state });

  return {
    roundId,
    size,
    mines,
    safeCells: safeCellsOf(state),
    k: 0,
    multiplier: 1,
    nextMultiplier: multAt(state, 1),
    points,
  };
}

export async function revealMinesCell(userId: number, roundId: string, row: number, col: number) {
  // Si otra petición cambia la ronda entre la lectura y el update, se relee
  // una vez: así dos reveal simultáneos nunca cuentan con un solo riesgo.
  for (let attempt = 0; attempt < 2; attempt++) {
    const round: MinesRound = await loadRound<MinesState>(roundId, userId, "mines");
    if (round.status !== "active") throw new GameError("ROUND_NOT_ACTIVE", 409);

    const s = round.state;
    if (
      !Number.isInteger(row) || !Number.isInteger(col) ||
      row < 0 || col < 0 || row >= s.size || col >= s.size
    ) {
      throw new GameError("INVALID_CELL", 400);
    }

    const cell = row * s.size + col;
    if (s.revealed.includes(cell)) throw new GameError("CELL_ALREADY_REVEALED", 409);

    const mines = cellsToCoords(s.mineCells, s.size);

    if (s.mineCells.includes(cell)) {
      if (!(await transitionRound(round, { status: "lost" }))) continue;
      return {
        result: "mine",
        finished: true,
        status: "lost",
        points: await getBalance(userId),
        mines,
      };
    }

    const state: MinesState = { ...s, revealed: [...s.revealed, cell] };
    const data = { result: "safe", ...progress(round.bet, state, state.revealed.length) };

    if (state.revealed.length < safeCellsOf(s)) {
      if (!(await transitionRound(round, { state }))) continue;
      return { ...data, finished: false };
    }

    // Tablero limpio: se paga automáticamente.
    const won = await transitionRound(round, { status: "won", state, payout: data.payout });
    if (!won) continue;
    return { ...data, finished: true, status: "won", points: await payRound(won), mines };
  }

  throw new GameError("ROUND_NOT_ACTIVE", 409);
}

export async function cashoutMines(userId: number, roundId: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const round: MinesRound = await loadRound<MinesState>(roundId, userId, "mines");
    const s = round.state;
    const k = s.revealed.length;

    let settled: MinesRound | null = null;
    if (round.status === "cashed_out" || round.status === "won") {
      // Ya cobrada (doble clic o reintento): el abono es idempotente.
      settled = round;
    } else if (round.status !== "active") {
      throw new GameError("ROUND_NOT_ACTIVE", 409);
    } else if (k === 0) {
      throw new GameError("NOTHING_TO_CASH_OUT", 409);
    } else {
      settled = await transitionRound(round, {
        status: "cashed_out",
        payout: Math.floor(round.bet * multAt(s, k)),
      });
      if (!settled) continue;
    }

    return {
      status: settled.status,
      multiplier: multAt(s, k),
      payout: settled.payout,
      points: await payRound(settled),
      mines: cellsToCoords(s.mineCells, s.size),
    };
  }

  throw new GameError("ROUND_NOT_ACTIVE", 409);
}

export async function getActiveMines(userId: number) {
  const round = await loadActiveRound<MinesState>(userId, "mines");
  if (!round) return null;

  const s = round.state;
  return {
    roundId: round.id,
    bet: round.bet,
    size: s.size,
    mines: s.mines,
    safeCells: safeCellsOf(s),
    ...progress(round.bet, s, s.revealed.length),
    revealed: cellsToCoords(s.revealed, s.size),
  };
}
