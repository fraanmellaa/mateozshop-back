import { NextRequest, NextResponse } from "next/server";

import { getUserByDiscordId } from "@/app/utils/users";
import { getAssociatedTikTokVideos, getUserTikTokConnection } from "@/app/utils/tiktok";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

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

    const requested = Number(request.nextUrl.searchParams.get("limit"));
    const limit =
      Number.isInteger(requested) && requested > 0
        ? Math.min(requested, MAX_LIMIT)
        : DEFAULT_LIMIT;

    const [connection, videos] = await Promise.all([
      getUserTikTokConnection(user.id),
      getAssociatedTikTokVideos(user.id, limit),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        linked: Boolean(connection),
        videos: videos.map((video) => ({
          id: video.video_id,
          title: video.title,
          cover_image_url: video.cover_image_url || "",
          view_count: video.view_count,
          like_count: video.like_count,
          comment_count: video.comment_count,
          share_count: video.share_count,
          create_time: video.created_at,
          share_url: video.share_url || undefined,
          leaderboard_id: video.leaderboard_id,
          is_banned: video.is_banned,
          // TikTok ya no lo devuelve (borrado o privado): no cuenta.
          unavailable: Boolean(video.unavailable_at),
        })),
      },
    });
  } catch (error) {
    console.error("Error en GET tiktok/videos:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
