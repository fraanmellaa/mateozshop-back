import { NextRequest } from "next/server";

import { requireExtensionUser } from "@/app/utils/extensionAuth";
import { extensionOk } from "@/app/utils/games/http";

export async function GET(request: NextRequest) {
  const auth = await requireExtensionUser(request);
  if (!auth.ok) return auth.response;

  const { user } = auth;

  return extensionOk({
    web: {
      id: user.id,
      name: user.username,
      avatar: user.image,
      points: user.points,
      isBanned: user.is_banned,
    },
    discord: {
      id: user.discord_id,
      name: user.username,
      avatar: user.image,
    },
    kick: {
      linked: Boolean(user.kick_id),
      name: user.kick_username,
    },
  });
}
