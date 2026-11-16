import { NextRequest } from "next/server";

import { accountErrorResponse } from "@/app/utils/accounts";
import { assertAdult } from "@/app/utils/accounts/adult";
import { economyErrorResponse, findEconomyUser } from "@/app/utils/economy/db";
import { openStreakBox } from "@/app/utils/economy/openings";
import { extensionError, requireExtensionUser } from "@/app/utils/extensionAuth";
import { extensionOk } from "@/app/utils/games/http";

// Abre la caja de racha desde la extensión. Mismas comprobaciones que la ruta
// de la web (baneo, +18 y disponibilidad); el usuario sale del JWT.
export async function POST(request: NextRequest) {
  const auth = await requireExtensionUser(request);
  if (!auth.ok) return auth.response;

  try {
    const user = await findEconomyUser(auth.user.discord_id);
    if (!user) return extensionError("USER_NOT_FOUND", 404);
    if (user.is_banned) return extensionError("USER_BANNED", 403);
    assertAdult(user);

    return extensionOk(await openStreakBox(user.id));
  } catch (error) {
    return accountErrorResponse(error) ?? economyErrorResponse(error, "Extension: error opening streak box");
  }
}
