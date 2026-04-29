import { NextRequest, NextResponse } from "next/server";

import { validateBearerToken } from "@/app/utils/bearerAuth";
import { getUserByDiscordId } from "@/app/utils/users";
import { refreshAssociatedTikTokVideosStats } from "@/app/utils/tiktok";

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

  try {
    const result = await refreshAssociatedTikTokVideosStats(user.id);

    return NextResponse.json({
      success: true,
      data: {
        refreshed: true,
        ...result,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "TIKTOK_REFRESH_POINTS_FAILED",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
