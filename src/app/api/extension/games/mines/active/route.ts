import { NextRequest } from "next/server";

import {
  extensionErrorResponse,
  extensionOk,
  requireActiveExtensionUser,
} from "@/app/utils/games/http";
import { getActiveMines } from "@/app/utils/games/minesRounds";

export async function GET(request: NextRequest) {
  const auth = await requireActiveExtensionUser(request);
  if (!auth.ok) return auth.response;

  try {
    return extensionOk(await getActiveMines(auth.user.id));
  } catch (error) {
    return extensionErrorResponse(error);
  }
}
