import { NextRequest, NextResponse } from "next/server";

import { validateBearerToken } from "@/app/utils/bearerAuth";
import { getUserByDiscordId } from "@/app/utils/users";
import { getUserTikTokConnection } from "@/app/utils/tiktok";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = validateBearerToken(request);
  if (authError) return authError;

  const resolvedParams = await params;
  const discordId = resolvedParams.id;

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

  return NextResponse.json({
    success: true,
    data: {
      linked: true,
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
}
