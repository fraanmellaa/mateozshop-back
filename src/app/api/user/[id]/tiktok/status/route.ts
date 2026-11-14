import { NextRequest, NextResponse } from "next/server";

import { getUserByDiscordId } from "@/app/utils/users";
import { getUserTikTokConnection } from "@/app/utils/tiktok";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: discordId } = await params;

    const user = await getUserByDiscordId(discordId);
    if (!user) {
      return NextResponse.json(
        { success: false, error: "USER_NOT_FOUND" },
        { status: 404 }
      );
    }

    const connection = await getUserTikTokConnection(user.id);

    if (!connection) {
      return NextResponse.json({
        success: true,
        data: {
          linked: false,
        },
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const needsRelink =
      Boolean(connection.needs_relink) || connection.refresh_token_expires_at <= now;

    return NextResponse.json({
      success: true,
      data: {
        // Con los tokens caducados la cuenta cuenta como no vinculada: el
        // usuario tiene que volver a pasar por el OAuth.
        linked: !needsRelink,
        needs_relink: needsRelink,
        account: {
          open_id: connection.open_id,
          display_name: connection.display_name,
          username: connection.username,
          avatar_url: connection.avatar_url,
        },
        expires_at: {
          access_token: connection.access_token_expires_at,
          refresh_token: connection.refresh_token_expires_at,
        },
        last_synced_at: connection.last_synced_at,
      },
    });
  } catch (error) {
    console.error("Error en GET tiktok/status:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
