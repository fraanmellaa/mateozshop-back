import { NextRequest, NextResponse } from "next/server";

import { validateBearerToken } from "@/app/utils/bearerAuth";
import { getUserByDiscordId } from "@/app/utils/users";
import {
  fetchTikTokUserInfo,
  getUserTikTokConnection,
  getValidTikTokAccessToken,
  revokeTikTokAccess,
  unlinkTikTokAccount,
} from "@/app/utils/tiktok";

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

  try {
    const accessToken = await getValidTikTokAccessToken(user.id);
    if (!accessToken) {
      return NextResponse.json({
        success: true,
        data: {
          linked: false,
        },
      });
    }

    const profile = await fetchTikTokUserInfo(accessToken);

    return NextResponse.json({
      success: true,
      data: {
        linked: true,
        account: {
          open_id: profile.open_id || connection.open_id,
          union_id: profile.union_id || connection.union_id,
          display_name: profile.display_name || connection.display_name,
          username: profile.username || connection.username,
          avatar_url: profile.avatar_url || connection.avatar_url,
          profile_deep_link:
            profile.profile_deep_link || connection.profile_deep_link,
          follower_count: profile.follower_count || 0,
          following_count: profile.following_count || 0,
          likes_count: profile.likes_count || 0,
          video_count: profile.video_count || 0,
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "TIKTOK_PROFILE_FAILED",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}

export async function DELETE(
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
        unlinked: true,
      },
    });
  }

  try {
    await revokeTikTokAccess(connection.access_token);
  } catch {
    // Best-effort revoke; we still remove local connection.
  }

  await unlinkTikTokAccount(user.id);

  return NextResponse.json({
    success: true,
    data: {
      unlinked: true,
    },
  });
}
