import { NextRequest } from "next/server";

import { requireExtensionUser } from "@/app/utils/extensionAuth";
import { extensionErrorResponse, extensionOk } from "@/app/utils/games/http";
import { getExtensionSettings } from "@/app/utils/settings";
import { requireEnv } from "@/lib/env";

export async function GET(request: NextRequest) {
  const auth = await requireExtensionUser(request);
  if (!auth.ok) return auth.response;

  try {
    const { watch, mines, crash, plinko } = await getExtensionSettings();
    const shop = requireEnv("FRONTEND_BASE_URL").replace(/\/+$/, "");

    // Solo valores públicos: ni los pesos del Plinko ni el borde del crash.
    return extensionOk({
      watch: {
        intervalSeconds: watch.intervalSeconds,
        pointsPerInterval: watch.pointsPerInterval,
        requireLive: watch.requireLive,
      },
      mines: {
        minBet: mines.minBet,
        maxBet: mines.maxBet,
        boardSizes: mines.boardSizes,
        maxMinePercent: mines.maxMinePercent,
        houseEdge: mines.houseEdge,
        maxMultiplier: mines.maxMultiplier,
      },
      crash: {
        minBet: crash.minBet,
        maxBet: crash.maxBet,
        maxMultiplier: crash.maxMultiplier,
        growthPerTick: crash.growthPerTick,
        tickMs: crash.tickMs,
      },
      plinko: {
        minBet: plinko.minBet,
        maxBet: plinko.maxBet,
        multipliers: plinko.multipliers,
      },
      links: {
        linkKick: `${shop}/mi-cuenta/kick`,
        shop,
      },
    });
  } catch (error) {
    return extensionErrorResponse(error);
  }
}
