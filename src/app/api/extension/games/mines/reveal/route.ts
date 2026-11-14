import { NextRequest } from "next/server";
import { z } from "zod";

import {
  extensionErrorResponse,
  extensionOk,
  readBody,
  requireActiveExtensionUser,
} from "@/app/utils/games/http";
import { revealMinesCell } from "@/app/utils/games/minesRounds";

const bodySchema = z.object({
  roundId: z.uuid(),
  row: z.number(),
  col: z.number(),
});

export async function POST(request: NextRequest) {
  const auth = await requireActiveExtensionUser(request);
  if (!auth.ok) return auth.response;

  try {
    const { roundId, row, col } = await readBody(request, bodySchema);
    return extensionOk(await revealMinesCell(auth.user.id, roundId, row, col));
  } catch (error) {
    return extensionErrorResponse(error);
  }
}
