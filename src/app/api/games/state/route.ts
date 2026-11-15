import { NextRequest } from "next/server";

import { getGamesState } from "@/app/utils/games/engine";
import { gameRoute } from "@/app/utils/games/http";

export function GET(request: NextRequest) {
  return gameRoute(request, "web", {}, ({ userId }) =>
    getGamesState(userId)
  );
}
