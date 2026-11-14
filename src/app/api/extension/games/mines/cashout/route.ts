import { NextRequest } from "next/server";
import { z } from "zod";

import {
  extensionErrorResponse,
  extensionOk,
  readBody,
  requireActiveExtensionUser,
} from "@/app/utils/games/http";
import { cashoutMines } from "@/app/utils/games/minesRounds";

const bodySchema = z.object({ roundId: z.uuid() });

export async function POST(request: NextRequest) {
  const auth = await requireActiveExtensionUser(request);
  if (!auth.ok) return auth.response;

  try {
    const { roundId } = await readBody(request, bodySchema);
    return extensionOk(await cashoutMines(auth.user.id, roundId));
  } catch (error) {
    return extensionErrorResponse(error);
  }
}
