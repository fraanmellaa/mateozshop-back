import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { safeEqual } from "@/lib/env";
import { hasQStashSigningKeys, verifyQStashSignature } from "@/app/utils/qstash";
import { refreshTikTokVideoRowsByIds } from "@/app/utils/tiktok";

const bodySchema = z.object({
  video_row_ids: z.array(z.number().int().positive()).min(1).max(100),
});

function unauthorized() {
  return NextResponse.json(
    {
      success: false,
      error: "UNAUTHORIZED_TASK",
    },
    { status: 401 }
  );
}

// Esta ruta está exenta del bearer global del middleware: se autentica sola con
// el secreto de la tarea y, si hay claves de firma configuradas, con la firma
// de QStash. Sin secreto configurado queda cerrada.
export async function POST(request: NextRequest) {
  const expected = process.env.TIKTOK_LEADERBOARD_TASK_SECRET;

  if (
    !expected ||
    !safeEqual(request.headers.get("authorization"), `Bearer ${expected}`)
  ) {
    return unauthorized();
  }

  const rawBody = await request.text();

  if (
    hasQStashSigningKeys() &&
    !(await verifyQStashSignature(request.headers.get("upstash-signature"), rawBody))
  ) {
    return unauthorized();
  }

  let body;
  try {
    body = bodySchema.parse(JSON.parse(rawBody));
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
    const result = await refreshTikTokVideoRowsByIds(body.video_row_ids);

    // Con fallos temporales se responde 502 para que QStash reintente.
    if (result.failed > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "TIKTOK_LEADERBOARD_VIDEO_REFRESH_INCOMPLETE",
          data: result,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error refrescando vídeos de TikTok (tarea):", error);
    return NextResponse.json(
      {
        success: false,
        error: "TIKTOK_LEADERBOARD_VIDEO_REFRESH_FAILED",
      },
      { status: 502 }
    );
  }
}
