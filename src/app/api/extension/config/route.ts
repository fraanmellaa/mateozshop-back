import { NextRequest } from "next/server";

import { requireExtensionUser } from "@/app/utils/extensionAuth";
import { publicGamesConfig } from "@/app/utils/games/engine";
import { extensionOk, gameErrorResponse } from "@/app/utils/games/http";
import { getGamesSettings } from "@/app/utils/settings";
import { requireEnv } from "@/lib/env";

// Nombre de canal de una env opcional; si falta o no es válido, "mateoz".
function channelName(env: string): string {
  const value = (process.env[env] ?? "").trim().toLowerCase();
  return /^[a-z0-9_]{1,40}$/.test(value) ? value : "mateoz";
}

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
        limits: { maxBalls: settings.plinko.maxBalls },
      },
      links: {
        shop,
        points: `${shop}/puntos`,
        giveaways: `${shop}/sorteos`,
        leaderboards: `${shop}/leaderboards`,
        news: `${shop}/novedades`,
        predictions: `${shop}/pronosticos`,
        streak: `${shop}/mi-cuenta/racha`,
        accounts: `${shop}/mi-cuenta/cuentas`,
        games: `${shop}/extension`,
        fair: `${shop}/extension#equidad`,
        boxOdds: `${shop}/bases-legales#cajas`,
        responsible: `${shop}/juego-responsable`,
        linkKick: `${shop}/mi-cuenta/cuentas`,
        linkTwitch: `${shop}/mi-cuenta/cuentas`,
        adult: shop,
      },
      // Canales donde la extensión enseña su panel.
      channels: {
        kick: channelName("KICK_CHANNEL"),
        twitch: channelName("TWITCH_CHANNEL"),
      },
    });
  } catch (error) {
    return gameErrorResponse(error, "extension");
  }
}
