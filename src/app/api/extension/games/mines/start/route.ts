import { NextRequest } from "next/server";

import { gameRoute } from "@/app/utils/games/http";
import { startMinesRound, minesStartBody } from "@/app/utils/games/minesRounds";

// Empieza una partida (cobra la apuesta). Nunca devuelve las posiciones de las minas.
export function POST(request: NextRequest) {
  return gameRoute(request, "extension", { schema: minesStartBody }, ({ userId, body }) =>
    startMinesRound(userId, body)
  );
}
