import { NextRequest } from "next/server";

import { gameRoute, parseId, spinBody } from "@/app/utils/games/http";
import { spinTournament } from "@/app/utils/games/tournament";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return gameRoute(request, "web", { schema: spinBody }, ({ userId, body }) =>
    spinTournament(userId, parseId(id), body.count)
  );
}
