import { NextRequest } from "next/server";

import { cashoutCrashBet } from "@/app/utils/games/crashRound";
import { gameRoute, crashRoundBody } from "@/app/utils/games/http";

// Retirada manual de mi apuesta al multiplicador del servidor en este instante.
export function POST(request: NextRequest) {
  return gameRoute(request, "extension", { schema: crashRoundBody }, ({ userId, body }) =>
    cashoutCrashBet(userId, body)
  );
}
