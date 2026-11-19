import { NextRequest, NextResponse } from "next/server";

import { accountErrorResponse } from "@/app/utils/accounts";
import { assertAdult } from "@/app/utils/accounts/adult";
import {
  betClassicPrediction,
  ClassicPredictionError,
  listClassicPredictionsForUser,
} from "@/app/utils/classicPredictions";
import { classicBetSchema } from "@/app/utils/classicPredictions/schema";
import { findEconomyUser } from "@/app/utils/economy/db";
import { extensionError, requireExtensionUser } from "@/app/utils/extensionAuth";
import { extensionOk } from "@/app/utils/games/http";

// Pone puntos a una opción de una predicción (Classic). Se descuentan al
// momento. Mismas comprobaciones que los juegos: sin baneo y con el +18.
export async function POST(request: NextRequest) {
  const auth = await requireExtensionUser(request);
  if (!auth.ok) return auth.response;

  const parsed = classicBetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return extensionError("INVALID_REQUEST_BODY", 400);

  try {
    const user = await findEconomyUser(auth.user.discord_id);
    if (!user) return extensionError("USER_NOT_FOUND", 404);
    if (user.is_banned) return extensionError("USER_BANNED", 403);
    assertAdult(user);

    const { balance } = await betClassicPrediction(user.id, parsed.data);
    // Los puntos ya están cobrados: si la lectura de después falla, no se
    // responde con error (el cliente repintaría con el siguiente sondeo).
    const list = await listClassicPredictionsForUser(user.id).catch(() => null);
    return extensionOk({ balance, ...(list ?? {}) });
  } catch (error) {
    if (error instanceof ClassicPredictionError) {
      // Con el detalle (mínimo y máximo que aún puede poner) cuando lo hay.
      return NextResponse.json({ success: false, error: error.code, ...error.extra }, { status: error.status });
    }
    const account = accountErrorResponse(error);
    if (account) return account;
    console.error("Extension: error betting on classic prediction:", error);
    return extensionError("INTERNAL_SERVER_ERROR", 500);
  }
}
