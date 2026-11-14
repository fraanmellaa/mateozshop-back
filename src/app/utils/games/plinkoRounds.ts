import { randomUUID } from "crypto";

import type { ExtensionSettings } from "@/app/utils/settings/schema";

import { drawPlinkoSlot } from "./plinko";
import { assertValidBet, chargeAndCreateRound, payRound } from "./rounds";

/** Apuesta, sorteo y premio en una sola petición; la ronda se guarda ya cerrada. */
export async function playPlinko(
  userId: number,
  bet: number,
  cfg: ExtensionSettings["plinko"]
) {
  assertValidBet(bet, cfg);

  const slot = drawPlinkoSlot(cfg.weights);
  const multiplier = cfg.multipliers[slot];
  const payout = Math.floor(bet * multiplier);
  const roundId = randomUUID();
  const status = payout > 0 ? "won" : "lost";

  let points = await chargeAndCreateRound({
    id: roundId,
    userId,
    game: "plinko",
    bet,
    state: { slot, multiplier },
    status,
    payout,
  });

  if (payout > 0) {
    points = await payRound({ id: roundId, user_id: userId, game: "plinko", payout });
  }

  return { slot, multiplier, payout, points };
}
