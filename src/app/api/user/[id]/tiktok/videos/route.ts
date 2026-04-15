import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { validateBearerToken } from "@/app/utils/bearerAuth";
import { getUserByDiscordId } from "@/app/utils/users";
import { fetchTikTokVideos, getValidTikTokAccessToken } from "@/app/utils/tiktok";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

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

  const parseResult = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );

  if (!parseResult.success) {
    return NextResponse.json(
      { success: false, error: "INVALID_QUERY_PARAMS", details: parseResult.error },
      { status: 400 }
    );
  }

  const accessToken = await getValidTikTokAccessToken(user.id);
  if (!accessToken) {
    return NextResponse.json(
      { success: false, error: "TIKTOK_NOT_LINKED" },
      { status: 404 }
    );
  }

  try {
    const limit = parseResult.data.limit ?? 5;
    const result = await fetchTikTokVideos(accessToken, limit);

    return NextResponse.json({
      success: true,
      data: {
        linked: true,
        limit,
        videos: result.videos,
        cursor: result.cursor,
        has_more: result.has_more,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "TIKTOK_VIDEOS_FAILED",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
