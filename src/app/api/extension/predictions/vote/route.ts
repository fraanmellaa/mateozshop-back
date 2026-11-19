import { NextRequest } from "next/server";

import { accountErrorResponse } from "@/app/utils/accounts";
import { assertAdult } from "@/app/utils/accounts/adult";
import { findEconomyUser } from "@/app/utils/economy/db";
import { extensionError, requireExtensionUser } from "@/app/utils/extensionAuth";
import { extensionOk } from "@/app/utils/games/http";
import {
  getCurrentStreamPrediction,
  StreamPredictionError,
  voteStreamPrediction,
} from "@/app/utils/streamPredictions";
import { voteStreamPredictionSchema } from "@/app/utils/streamPredictions/schema";

// Vota en la predicción del directo. Gratis, un voto por persona y sin cambios.
// Mismas comprobaciones que las cajas gratis: sin baneo y con el +18 confirmado.
export async function POST(request: NextRequest) {
  const auth = await requireExtensionUser(request);
  if (!auth.ok) return auth.response;

  const parsed = voteStreamPredictionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return extensionError("INVALID_REQUEST_BODY", 400);

  try {
    const user = await findEconomyUser(auth.user.discord_id);
    if (!user) return extensionError("USER_NOT_FOUND", 404);
    if (user.is_banned) return extensionError("USER_BANNED", 403);
    assertAdult(user);

    const { predictionId, option, number } = parsed.data;
    await voteStreamPrediction(user.id, predictionId, { option, number });
    return extensionOk({ prediction: await getCurrentStreamPrediction(user.id) });
  } catch (error) {
    if (error instanceof StreamPredictionError) return extensionError(error.code, error.status);
    const account = accountErrorResponse(error);
    if (account) return account;
    console.error("Extension: error voting stream prediction:", error);
    return extensionError("INTERNAL_SERVER_ERROR", 500);
  }
}
