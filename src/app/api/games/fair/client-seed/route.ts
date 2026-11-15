import { NextRequest } from "next/server";

import { setClientSeed } from "@/app/utils/games/engine";
import { gameRoute, clientSeedBody } from "@/app/utils/games/http";

export function POST(request: NextRequest) {
  return gameRoute(request, "web", { schema: clientSeedBody }, ({ userId, body }) =>
    setClientSeed(userId, body.client_seed)
  );
}
