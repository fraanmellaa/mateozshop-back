import { NextRequest } from "next/server";

import { listClassicPredictionsForUser } from "@/app/utils/classicPredictions";
import { extensionError, requireExtensionUser } from "@/app/utils/extensionAuth";
import { extensionOk } from "@/app/utils/games/http";

// Predicciones (Classic) que se enseñan en la extensión: las que están en
// marcha y las terminadas hace poco, con la jugada del usuario. `now` es la
// hora del servidor, para la cuenta atrás de las que llevan temporizador.
export async function GET(request: NextRequest) {
  const auth = await requireExtensionUser(request);
  if (!auth.ok) return auth.response;

  try {
    return extensionOk(await listClassicPredictionsForUser(auth.user.id));
  } catch (error) {
    console.error("Extension: error loading classic predictions:", error);
    return extensionError("INTERNAL_SERVER_ERROR", 500);
  }
}
