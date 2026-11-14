import { NextRequest, NextResponse } from "next/server";

import { getUserByDiscordId } from "@/app/utils/users";
import {
  findOwnedTikTokVideo,
  getUserTikTokConnection,
  resolveTikTokVideoId,
  saveAssociatedTikTokVideo,
  TikTokApiError,
  TikTokRelinkRequiredError,
  TikTokRuleError,
} from "@/app/utils/tiktok";
import { getTikTokLeaderboardForVideoAssociation } from "@/app/utils/tiktok/leaderboards";

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ success: false, error, message }, { status });
}

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

    if (user.is_banned) {
      return fail(403, "USER_BANNED", "Tu cuenta no puede participar en las leaderboards.");
    }

    const body = await request.json().catch(() => null);
    const videoUrl = typeof body?.video_url === "string" ? body.video_url.trim() : "";
    const leaderboardId =
      typeof body?.leaderboard_id === "number" && Number.isInteger(body.leaderboard_id)
        ? (body.leaderboard_id as number)
        : null;

    if (!videoUrl) {
      return fail(400, "VIDEO_URL_REQUIRED", "Debes enviar la URL del video de TikTok.");
    }

    const connection = await getUserTikTokConnection(user.id);
    if (!connection) {
      return fail(
        404,
        "TIKTOK_NOT_CONNECTED",
        "No hay una cuenta de TikTok vinculada para este usuario."
      );
    }

    const videoId = await resolveTikTokVideoId(videoUrl);
    if (!videoId) {
      return fail(
        400,
        "INVALID_VIDEO_URL",
        "URL inválida. Debe tener formato https://www.tiktok.com/@usuario/video/ID"
      );
    }

    let leaderboard = null;
    const now = Math.floor(Date.now() / 1000);

    if (leaderboardId !== null) {
      leaderboard = await getTikTokLeaderboardForVideoAssociation(leaderboardId);

      if (!leaderboard) {
        return fail(404, "LEADERBOARD_NOT_FOUND", "No se ha encontrado la leaderboard indicada.");
      }

      const isActiveWindow = leaderboard.start_at <= now && leaderboard.end_at > now;
      const allowsAssociation =
        isActiveWindow &&
        (leaderboard.status === "active" || leaderboard.status === "scheduled");

      if (!allowsAssociation) {
        return fail(
          400,
          "LEADERBOARD_NOT_ACTIVE",
          "Solo puedes vincular videos desde una leaderboard activa."
        );
      }
    }

    // La Display API solo devuelve vídeos de la cuenta del token: encontrarlo
    // ahí es la prueba de que el vídeo es de la cuenta vinculada.
    const video = await findOwnedTikTokVideo(connection, videoId);

    if (!video) {
      return fail(
        404,
        "VIDEO_NOT_FOUND",
        "No se ha encontrado ese video entre los videos públicos de tu cuenta de TikTok vinculada."
      );
    }

    if (leaderboard) {
      // Solo cuentan los vídeos publicados dentro de la ventana de la leaderboard.
      const createdAt = Number(video.create_time || 0);

      if (!createdAt || createdAt < leaderboard.start_at || createdAt > leaderboard.end_at) {
        return fail(
          400,
          "VIDEO_OUTSIDE_LEADERBOARD_WINDOW",
          "El video se publicó fuera de las fechas de esta leaderboard y no puede participar."
        );
      }
    }

    const savedVideo = await saveAssociatedTikTokVideo({
      userId: user.id,
      openId: connection.open_id,
      video: { ...video, id: videoId },
      fallbackShareUrl: videoUrl,
      leaderboardId: leaderboard ? leaderboard.id : null,
    });

    return NextResponse.json({
      success: true,
      data: {
        associated: true,
        leaderboard_linked: savedVideo.leaderboard_id !== null,
        leaderboard_id: savedVideo.leaderboard_id,
        video: savedVideo,
      },
    });
  } catch (error) {
    if (error instanceof TikTokRelinkRequiredError) {
      return fail(
        409,
        "TIKTOK_RELINK_REQUIRED",
        "Tu vinculación con TikTok ha caducado. Vuelve a vincular tu cuenta."
      );
    }

    if (error instanceof TikTokRuleError && error.code === "VIDEO_ALREADY_ASSOCIATED") {
      return fail(409, "VIDEO_ALREADY_ASSOCIATED", "Ese video ya lo ha asociado otro usuario.");
    }

    if (error instanceof TikTokApiError) {
      console.error("TikTok falló al verificar el vídeo:", error.code, error.message);
      return fail(
        502,
        "TIKTOK_UNAVAILABLE",
        "No se ha podido comprobar el video en TikTok. Inténtalo de nuevo en unos minutos."
      );
    }

    console.error("Error asociando vídeo de TikTok:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
