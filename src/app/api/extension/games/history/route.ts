import { NextRequest } from "next/server";

import { getRoundHistory } from "@/app/utils/games/engine";
import { gameRoute } from "@/app/utils/games/http";

export function GET(request: NextRequest) {
  return gameRoute(request, "extension", {}, ({ userId }) =>
    getRoundHistory(userId)
  );
}
