import { NextRequest } from "next/server";

import { extensionError, requireExtensionUser } from "@/app/utils/extensionAuth";
import { extensionOk } from "@/app/utils/games/http";
import { getCurrentStreamPrediction } from "@/app/utils/streamPredictions";

// Predicción del directo que se enseña en la extensión: la que está en marcha
// o la última resuelta hace poco. `prediction: null` si no hay ninguna.
export async function GET(request: NextRequest) {
  const auth = await requireExtensionUser(request);
  if (!auth.ok) return auth.response;

  try {
    return extensionOk({ prediction: await getCurrentStreamPrediction(auth.user.id) });
  } catch (error) {
    console.error("Extension: error loading stream prediction:", error);
    return extensionError("INTERNAL_SERVER_ERROR", 500);
  }
}
