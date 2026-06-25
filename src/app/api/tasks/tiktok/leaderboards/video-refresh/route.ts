import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { refreshAssociatedTikTokVideoStatsByRowId } from "@/app/utils/tiktok";

const bodySchema = z.object({
  video_row_id: z.number().int().positive(),
  leaderboard_id: z.number().int().positive().optional(),
  video_id: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const expected = process.env.TIKTOK_LEADERBOARD_TASK_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json(
      {
        success: false,
        error: "UNAUTHORIZED_TASK",
      },
      { status: 401 }
    );
  }

  let body;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "INVALID_TASK_BODY",
      },
      { status: 400 }
    );
  }

  try {
    const result = await refreshAssociatedTikTokVideoStatsByRowId(body.video_row_id);

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "TIKTOK_LEADERBOARD_VIDEO_REFRESH_FAILED",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
