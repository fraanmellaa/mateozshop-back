import { NextRequest } from "next/server";
import { z } from "zod";

import {
  extensionErrorResponse,
  extensionOk,
  readBody,
  requireActiveExtensionUser,
} from "@/app/utils/games/http";
import { playPlinko } from "@/app/utils/games/plinkoRounds";
import { getExtensionSettings } from "@/app/utils/settings";

const bodySchema = z.object({ bet: z.number().int() });

export async function POST(request: NextRequest) {
  const auth = await requireActiveExtensionUser(request);
  if (!auth.ok) return auth.response;

  try {
    const { bet } = await readBody(request, bodySchema);
    const { plinko } = await getExtensionSettings();
    return extensionOk(await playPlinko(auth.user.id, bet, plinko));
  } catch (error) {
    return extensionErrorResponse(error);
  }
}
