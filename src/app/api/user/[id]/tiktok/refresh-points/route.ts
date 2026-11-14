import { NextRequest, NextResponse } from "next/server";

import { getUserByDiscordId } from "@/app/utils/users";
import {
  refreshAssociatedTikTokVideosStats,
  TikTokRelinkRequiredError,
  TikTokRuleError,
} from "@/app/utils/tiktok";

export async function POST(
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

    const result = await refreshAssociatedTikTokVideosStats(user.id);

    if (result.cooldown) {
      return NextResponse.json(
        {
          success: false,
          error: "TIKTOK_REFRESH_COOLDOWN",
          message: `Espera ${result.retry_after} s antes de volver a actualizar.`,
          retry_after: result.retry_after,
        },
        { status: 429, headers: { "Retry-After": String(result.retry_after) } }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        refreshed: true,
        updated: result.updated,
        not_found: result.not_found,
        failed: result.failed,
        total: result.total,
      },
    });
  } catch (error) {
    if (error instanceof TikTokRelinkRequiredError) {
      return NextResponse.json(
        {
          success: false,
          error: "TIKTOK_RELINK_REQUIRED",
          message: "Tu vinculación con TikTok ha caducado. Vuelve a vincular tu cuenta.",
        },
        { status: 409 }
      );
    }

    if (error instanceof TikTokRuleError && error.code === "TIKTOK_NOT_CONNECTED") {
      return NextResponse.json(
        {
          success: false,
          error: "TIKTOK_NOT_CONNECTED",
          message: "No hay una cuenta de TikTok vinculada para este usuario.",
        },
        { status: 404 }
      );
    }

    console.error("Error refrescando vídeos de TikTok:", error);
    return NextResponse.json(
      { success: false, error: "TIKTOK_REFRESH_POINTS_FAILED" },
      { status: 502 }
    );
  }
}
