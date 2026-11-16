import { NextRequest } from "next/server";

import { gameRoute } from "@/app/utils/games/http";
import { cashoutMinesRound, minesRoundBody } from "@/app/utils/games/minesRounds";

// Plantarse: cobra apuesta × multiplicador actual, una sola vez.
export function POST(request: NextRequest) {
  return gameRoute(request, "extension", { schema: minesRoundBody }, ({ userId, body }) =>
    cashoutMinesRound(userId, body)
  );
}
