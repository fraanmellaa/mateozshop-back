import { NextRequest } from "next/server";

import { gameRoute } from "@/app/utils/games/http";
import { cancelMinesRound, minesRoundBody } from "@/app/utils/games/minesRounds";

// Cancela una partida sin ninguna casilla destapada (devuelve la apuesta).
export function POST(request: NextRequest) {
  return gameRoute(request, "extension", { schema: minesRoundBody }, ({ userId, body }) =>
    cancelMinesRound(userId, body)
  );
}
