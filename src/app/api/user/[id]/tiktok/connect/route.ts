import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { validateBearerToken } from "@/app/utils/bearerAuth";
import { getUserByDiscordId } from "@/app/utils/users";
import {
  exchangeCodeForTokens,
  fetchTikTokUserInfo,
  saveTikTokConnection,
  verifyTikTokLinkState,
} from "@/app/utils/tiktok";

const bodySchema = z.object({
  code: z.string().min(5),
  redirect_uri: z.url().optional(),
  state: z.string().min(10),
});

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

  const parsedBody = bodySchema.safeParse(await request.json());
  if (!parsedBody.success) {
    return NextResponse.json(
      { success: false, error: "INVALID_REQUEST_BODY", details: parsedBody.error },
      { status: 400 }
    );
  }

  const redirectUri = parsedBody.data.redirect_uri || process.env.TIKTOK_REDIRECT_URI || "";
  if (!redirectUri) {
    return NextResponse.json(
      {
        success: false,
        error: "MISSING_REDIRECT_URI",
        message:
          "Send redirect_uri in body or configure TIKTOK_REDIRECT_URI in backend env.",
      },
      { status: 400 }
    );
  }

  const decodedState = verifyTikTokLinkState(parsedBody.data.state);
  if (!decodedState || decodedState.discord_id !== discordId) {
    return NextResponse.json(
      { success: false, error: "INVALID_STATE" },
      { status: 400 }
    );
  }

  if (!decodedState.code_verifier) {
    return NextResponse.json(
      { success: false, error: "INVALID_STATE_PKCE" },
      { status: 400 }
    );
  }

  try {
    const tokens = await exchangeCodeForTokens({
      code: parsedBody.data.code,
      redirectUri,
      codeVerifier: decodedState.code_verifier,
    });

    const profile = await fetchTikTokUserInfo(tokens.access_token);

    await saveTikTokConnection({
      userId: user.id,
      tokens,
      profile,
    });

    return NextResponse.json({
      success: true,
      data: {
        linked: true,
        open_id: tokens.open_id,
        scope: tokens.scope,
        profile,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "TIKTOK_CONNECT_FAILED",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
