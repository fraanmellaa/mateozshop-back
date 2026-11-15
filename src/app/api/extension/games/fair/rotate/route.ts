import { NextRequest } from "next/server";

import { rotateSeed } from "@/app/utils/games/engine";
import { gameRoute, rotateBody } from "@/app/utils/games/http";

export function POST(request: NextRequest) {
  return gameRoute(request, "extension", { schema: rotateBody }, ({ userId, body }) =>
    rotateSeed(userId, body.client_seed)
  );
}
