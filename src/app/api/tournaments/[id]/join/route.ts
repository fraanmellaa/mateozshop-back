import { NextRequest } from "next/server";

import { emptyBody, gameRoute, parseId } from "@/app/utils/games/http";
import { joinTournament } from "@/app/utils/games/tournament";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return gameRoute(request, "web", { schema: emptyBody }, ({ userId }) =>
    joinTournament(userId, parseId(id))
  );
}
