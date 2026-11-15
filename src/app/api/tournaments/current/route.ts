import { NextRequest } from "next/server";

import { extensionOk, gameErrorResponse, gameRoute } from "@/app/utils/games/http";
import { getCurrentTournament } from "@/app/utils/games/tournament";

export async function GET(request: NextRequest) {
  // Sin sesión (sin discord_id) se puede ver el torneo y el ranking público.
  if (!request.nextUrl.searchParams.get("discord_id")) {
    try {
      return extensionOk(await getCurrentTournament(null));
    } catch (error) {
      return gameErrorResponse(error, "web");
    }
  }

  return gameRoute(request, "web", {}, ({ userId }) => getCurrentTournament(userId));
}
