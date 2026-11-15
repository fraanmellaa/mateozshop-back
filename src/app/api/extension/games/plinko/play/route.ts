import { NextRequest } from "next/server";

import { playPlinkoRounds } from "@/app/utils/games/engine";
import { gameRoute, plinkoBody } from "@/app/utils/games/http";

export function POST(request: NextRequest) {
  return gameRoute(request, "extension", { schema: plinkoBody }, ({ userId, body }) =>
    playPlinkoRounds(userId, body)
  );
}
