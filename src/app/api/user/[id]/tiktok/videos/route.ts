import { NextRequest, NextResponse } from "next/server";

import { validateBearerToken } from "@/app/utils/bearerAuth";
import { getUserByDiscordId } from "@/app/utils/users";
import { getAssociatedTikTokVideos } from "@/app/utils/tiktok";

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

  const videos = await getAssociatedTikTokVideos(user.id);

  return NextResponse.json({
    success: true,
    data: {
      linked: true,
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
      })),
    },
  });
}
