import { NextRequest } from "next/server";

import { getSeedHistory } from "@/app/utils/games/engine";
import { gameRoute } from "@/app/utils/games/http";

export function GET(request: NextRequest) {
  return gameRoute(request, "extension", {}, ({ userId }) =>
    getSeedHistory(userId)
  );
}
