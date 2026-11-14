import { NextRequest, NextResponse } from "next/server";

import { getUserByDiscordId } from "@/app/utils/users";
import {
  fetchTikTokProfileForAccount,
  getUserTikTokConnection,
  revokeTikTokAccess,
  TikTokRelinkRequiredError,
  unlinkTikTokAccount,
} from "@/app/utils/tiktok";

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

    const storedAccount = {
      open_id: connection.open_id,
      union_id: connection.union_id,
      display_name: connection.display_name,
      username: connection.username,
      avatar_url: connection.avatar_url,
      profile_deep_link: connection.profile_deep_link,
      follower_count: 0,
      following_count: 0,
      likes_count: 0,
      video_count: 0,
    };

    try {
      const profile = await fetchTikTokProfileForAccount(connection);

      return NextResponse.json({
        success: true,
        data: {
          linked: true,
          needs_relink: false,
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
      if (error instanceof TikTokRelinkRequiredError) {
        // Los tokens ya no sirven: se trata como no vinculada para que el
        // usuario vuelva a pasar por el OAuth.
        return NextResponse.json({
          success: true,
          data: {
            linked: false,
            needs_relink: true,
            account: storedAccount,
          },
        });
      }

      console.error("Error leyendo el perfil de TikTok:", error);
      return NextResponse.json(
        { success: false, error: "TIKTOK_PROFILE_FAILED" },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error("Error en GET tiktok:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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
          unlinked: true,
        },
      });
    }

    // Borra también los vídeos de leaderboards sin finalizar: dejan de contar.
    await unlinkTikTokAccount(user.id);

    try {
      await revokeTikTokAccess(connection.access_token);
    } catch {
      // La revocación en TikTok es de mejor esfuerzo; la cuenta ya está desvinculada.
    }

    return NextResponse.json({
      success: true,
      data: {
        unlinked: true,
      },
    });
  } catch (error) {
    console.error("Error desvinculando TikTok:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
