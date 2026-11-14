import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { setTikTokVideoBanned } from "@/app/utils/tiktok/leaderboards";

// Vetar (o readmitir) un vídeo: un vídeo vetado no cuenta en el ranking ni en
// el snapshot final.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ videoRowId: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const videoRowId = Number((await params).videoRowId);

    if (!Number.isInteger(videoRowId) || videoRowId <= 0) {
      return NextResponse.json(
        { success: false, error: "INVALID_VIDEO_ID" },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => null);

    if (typeof body?.is_banned !== "boolean") {
      return NextResponse.json(
        { success: false, error: "INVALID_REQUEST_BODY" },
        { status: 400 }
      );
    }

    const updated = await setTikTokVideoBanned(videoRowId, body.is_banned);

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "VIDEO_NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, result: updated });
  } catch (error) {
    console.error("Error updating TikTok video ban:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
