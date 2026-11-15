import { NextRequest } from "next/server";

import { playCrashRound } from "@/app/utils/games/engine";
import { gameRoute, crashBody } from "@/app/utils/games/http";

export function POST(request: NextRequest) {
  return gameRoute(request, "extension", { schema: crashBody }, ({ userId, body }) =>
    playCrashRound(userId, body)
  );
}
