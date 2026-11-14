import { NextRequest } from "next/server";
import { z } from "zod";

import { cashoutCrash } from "@/app/utils/games/crashRounds";
import {
  extensionErrorResponse,
  extensionOk,
  readBody,
  requireActiveExtensionUser,
} from "@/app/utils/games/http";

const bodySchema = z.object({ roundId: z.uuid() });

export async function POST(request: NextRequest) {
  const auth = await requireActiveExtensionUser(request);
  if (!auth.ok) return auth.response;

  try {
    const { roundId } = await readBody(request, bodySchema);
    return extensionOk(await cashoutCrash(auth.user.id, roundId));
  } catch (error) {
    return extensionErrorResponse(error);
  }
}
