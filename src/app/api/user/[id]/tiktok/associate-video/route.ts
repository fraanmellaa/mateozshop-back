import { NextRequest, NextResponse } from "next/server";

import { validateBearerToken } from "@/app/utils/bearerAuth";
import { getUserByDiscordId } from "@/app/utils/users";
import {
  fetchTikTokPublicVideoDetail,
  getUserTikTokConnection,
  upsertAssociatedTikTokVideo,
} from "@/app/utils/tiktok";

type ParsedTikTokVideoUrl = {
  videoId: string;
  username: string;
};

function parseTikTokVideoUrl(rawUrl: string): ParsedTikTokVideoUrl | null {
  try {
    const parsed = new URL(rawUrl);

    if (!parsed.hostname.includes("tiktok.com")) {
      return null;
    }

    const match = parsed.pathname.match(/^\/@([^/]+)\/video\/(\d+)\/?$/i);
    if (!match) {
      return null;
    }

    return {
      username: match[1],
      videoId: match[2],
    };
  } catch {
    return null;
  }
}

export async function POST(
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

  const body = await request.json().catch(() => null);
  const videoUrl = typeof body?.video_url === "string" ? body.video_url.trim() : "";

  if (!videoUrl) {
    return NextResponse.json(
      {
        success: false,
        error: "VIDEO_URL_REQUIRED",
        message: "Debes enviar la URL del video de TikTok.",
      },
      { status: 400 }
    );
  }

  const parsedVideo = parseTikTokVideoUrl(videoUrl);
  if (!parsedVideo) {
    return NextResponse.json(
      {
        success: false,
        error: "INVALID_VIDEO_URL",
        message:
          "URL inválida. Debe tener formato https://www.tiktok.com/@usuario/video/ID",
      },
      { status: 400 }
    );
  }

  const connection = await getUserTikTokConnection(user.id);
  if (!connection) {
    return NextResponse.json(
      {
        success: false,
        error: "TIKTOK_NOT_CONNECTED",
        message: "No hay una cuenta de TikTok vinculada para este usuario.",
      },
      { status: 404 }
    );
  }

  // Fetch video data from public TikTok API (no bearer needed).
  const publicVideo = await fetchTikTokPublicVideoDetail(parsedVideo.videoId);

  if (!publicVideo) {
    return NextResponse.json(
      {
        success: false,
        error: "VIDEO_NOT_FOUND",
        message: "No se encontró ese video en TikTok.",
      },
      { status: 404 }
    );
  }

  // Validate ownership: author from URL and from public API must match
  // the linked TikTok account username.
  const linkedUsername = connection.username || "";
  const authorFromUrl = parsedVideo.username.toLowerCase();
  const authorFromApi = publicVideo.author_unique_id.toLowerCase();

  if (authorFromUrl !== authorFromApi) {
    return NextResponse.json(
      {
        success: false,
        error: "VIDEO_OWNER_MISMATCH",
        message: "El video no pertenece a la cuenta de TikTok vinculada actualmente.",
      },
      { status: 400 }
    );
  }

  if (
    linkedUsername &&
    linkedUsername.toLowerCase() !== authorFromApi
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "VIDEO_OWNER_MISMATCH",
        message: "El video no pertenece a la cuenta de TikTok vinculada actualmente.",
      },
      { status: 400 }
    );
  }

  const savedVideo = await upsertAssociatedTikTokVideo({
    userId: user.id,
    videoId: parsedVideo.videoId,
    title: publicVideo.title || "Video sin titulo",
    coverImageUrl: publicVideo.cover_image_url || null,
    shareUrl: publicVideo.share_url || videoUrl,
    likeCount: publicVideo.like_count,
    viewCount: publicVideo.view_count,
    commentCount: publicVideo.comment_count,
    shareCount: publicVideo.share_count,
    createdAt: publicVideo.create_time || Math.floor(Date.now() / 1000),
  });

  return NextResponse.json({
    success: true,
    data: {
      associated: true,
      video: savedVideo,
    },
  });
}
