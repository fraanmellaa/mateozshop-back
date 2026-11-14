import { NextRequest } from "next/server";

import {
  extensionErrorResponse,
  extensionOk,
  requireActiveExtensionUser,
} from "@/app/utils/games/http";
import { getLiveStatus } from "@/app/utils/kick/live";
import { watchHeartbeat } from "@/app/utils/points";
import { getExtensionSettings } from "@/app/utils/settings";

// Con el canal apagado, cada cuánto vuelve a preguntar el cliente.
const OFFLINE_RETRY_SECONDS = 60;

export async function POST(request: NextRequest) {
  const auth = await requireActiveExtensionUser(request);
  if (!auth.ok) return auth.response;

  try {
    const { watch } = await getExtensionSettings();

    if (watch.requireLive && !(await getLiveStatus())) {
      return extensionOk({
        awarded: 0,
        points: auth.user.points,
        nextInSeconds: Math.min(watch.intervalSeconds, OFFLINE_RETRY_SECONDS),
        live: false,
        capReached: false,
      });
    }

    const result = await watchHeartbeat(
      auth.user.id,
      watch.intervalSeconds,
      watch.pointsPerInterval,
      watch.dailyCap
    );

    return extensionOk({
      awarded: result.awarded,
      points: result.balance,
      nextInSeconds: result.next_in,
      // Si no se exige directo no se consulta a Kick: el latido cuenta igual.
      live: true,
      capReached: result.cap_reached,
    });
  } catch (error) {
    return extensionErrorResponse(error);
  }
}
