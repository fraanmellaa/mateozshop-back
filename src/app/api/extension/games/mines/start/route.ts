import { NextRequest } from "next/server";
import { z } from "zod";

import {
  extensionErrorResponse,
  extensionOk,
  readBody,
  requireActiveExtensionUser,
} from "@/app/utils/games/http";
import { startMines } from "@/app/utils/games/minesRounds";
import { getExtensionSettings } from "@/app/utils/settings";

const bodySchema = z.object({
  bet: z.number().int(),
  size: z.number().int(),
  mines: z.number().int(),
});

export async function POST(request: NextRequest) {
  const auth = await requireActiveExtensionUser(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await readBody(request, bodySchema);
    const { mines } = await getExtensionSettings();
    return extensionOk(await startMines(auth.user.id, body, mines));
  } catch (error) {
    return extensionErrorResponse(error);
  }
}
