import { NextRequest } from "next/server";

import { requireExtensionUser } from "@/app/utils/extensionAuth";
import { getCrashRound } from "@/app/utils/games/crashRound";
import { extensionOk, gameErrorResponse } from "@/app/utils/games/http";

// Sondeo de la ronda global de Crash (~cada 500 ms con el panel abierto): avanza
// el ciclo si toca y devuelve la fase, mi apuesta, los jugadores y las últimas
// explosiones. Nunca el punto ni la semilla de la ronda en curso.
export async function GET(request: NextRequest) {
  const auth = await requireExtensionUser(request);
  if (!auth.ok) return auth.response;
  try {
    return extensionOk(await getCrashRound(auth.user.id, auth.user.points));
  } catch (error) {
    return gameErrorResponse(error, "extension");
  }
}
