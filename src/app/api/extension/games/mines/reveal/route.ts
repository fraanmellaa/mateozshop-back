import { NextRequest } from "next/server";

import { gameRoute } from "@/app/utils/games/http";
import { revealMinesCell, minesRevealBody } from "@/app/utils/games/minesRounds";

// Destapa una casilla. Las minas solo se devuelven si la partida termina.
export function POST(request: NextRequest) {
  return gameRoute(request, "extension", { schema: minesRevealBody }, ({ userId, body }) =>
    revealMinesCell(userId, body)
  );
}
