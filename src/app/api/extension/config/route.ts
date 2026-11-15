import { NextRequest } from "next/server";

import { requireExtensionUser } from "@/app/utils/extensionAuth";
import { publicGamesConfig } from "@/app/utils/games/engine";
import { extensionOk, gameErrorResponse } from "@/app/utils/games/http";
import { getGamesSettings } from "@/app/utils/settings";
import { requireEnv } from "@/lib/env";

export async function GET(request: NextRequest) {
  const auth = await requireExtensionUser(request);
  if (!auth.ok) return auth.response;

  try {
    const settings = await getGamesSettings();
    const shop = requireEnv("FRONTEND_BASE_URL").replace(/\/+$/, "");

    // Solo valores públicos: tablas, límites y RTP. Nada de semillas.
    return extensionOk({
      games: {
        ...publicGamesConfig(settings),
        limits: {
          dailyWagerCap: settings.dailyWagerCap,
          maxBalls: settings.plinko.maxBalls,
        },
        dailyCap: settings.dailyWagerCap,
      },
      links: {
        shop,
        games: `${shop}/juegos`,
        linkKick: `${shop}/mi-cuenta/kick`,
        linkTwitch: `${shop}/mi-cuenta/cuentas`,
        adult: shop,
        fair: `${shop}/juegos#equidad`,
      },
    });
  } catch (error) {
    return gameErrorResponse(error, "extension");
  }
}
