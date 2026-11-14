import { NextRequest } from "next/server";
import { z } from "zod";

import { getCrash } from "@/app/utils/games/crashRounds";
import {
  extensionErrorResponse,
  extensionOk,
  requireActiveExtensionUser,
} from "@/app/utils/games/http";
import { extensionError } from "@/app/utils/extensionAuth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roundId: string }> }
) {
  const auth = await requireActiveExtensionUser(request);
  if (!auth.ok) return auth.response;

  const { roundId } = await params;
  if (!z.uuid().safeParse(roundId).success) {
    return extensionError("ROUND_NOT_FOUND", 404);
  }

  try {
    return extensionOk(await getCrash(auth.user.id, roundId));
  } catch (error) {
    return extensionErrorResponse(error);
  }
}
