import { NextRequest } from "next/server";

import { placeCrashBet } from "@/app/utils/games/crashRound";
import { gameRoute, crashBetBody } from "@/app/utils/games/http";

// Apuesta en la ronda global, solo durante su fase de apuestas.
export function POST(request: NextRequest) {
  return gameRoute(request, "extension", { schema: crashBetBody }, ({ userId, body }) =>
    placeCrashBet(userId, body)
  );
}
