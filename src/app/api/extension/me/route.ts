import { NextRequest, NextResponse } from "next/server";

import { getUserByDiscordId } from "@/app/utils/users";
import { validateExtensionKey, verifyExtensionUser } from "@/app/utils/extensionAuth";

export async function GET(request: NextRequest) {
  const keyError = validateExtensionKey(request);
  if (keyError) return keyError;

  const verified = await verifyExtensionUser(request);
  if (!verified.ok) return verified.response;

  const user = await getUserByDiscordId(verified.discordId);
  if (!user) {
    return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json(
    {
      success: true,
      web: {
        id: user.id,
        name: user.username,
        avatar: user.image,
        points: user.actual_points,
        isBanned: false,
      },
      discord: {
        id: user.discord_id,
        name: user.username,
        avatar: user.image,
        email: user.email,
      },
      kick: {
        name: user.kick_username,
        isBanned: false,
      },
    },
    { status: 200 }
  );
}
