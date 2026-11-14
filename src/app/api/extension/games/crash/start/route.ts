import { NextRequest } from "next/server";
import { z } from "zod";

import { startCrash } from "@/app/utils/games/crashRounds";
import {
  extensionErrorResponse,
  extensionOk,
  readBody,
  requireActiveExtensionUser,
} from "@/app/utils/games/http";
import { getExtensionSettings } from "@/app/utils/settings";

const bodySchema = z.object({ bet: z.number().int() });

export async function POST(request: NextRequest) {
  const auth = await requireActiveExtensionUser(request);
  if (!auth.ok) return auth.response;

  try {
    const { bet } = await readBody(request, bodySchema);
    const { crash } = await getExtensionSettings();
    return extensionOk(await startCrash(auth.user.id, bet, crash));
  } catch (error) {
    return extensionErrorResponse(error);
  }
}
