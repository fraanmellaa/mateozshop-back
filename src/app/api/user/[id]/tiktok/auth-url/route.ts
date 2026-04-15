import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { validateBearerToken } from "@/app/utils/bearerAuth";
import { getUserByDiscordId } from "@/app/utils/users";
import {
  createTikTokLinkState,
  getRequiredTikTokScopes,
  getTikTokAuthUrl,
} from "@/app/utils/tiktok";

const querySchema = z.object({
  redirect_uri: z.url().optional(),
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

  const redirectUri =
    parseResult.data.redirect_uri || process.env.TIKTOK_REDIRECT_URI || "";

  if (!redirectUri) {
    return NextResponse.json(
      {
        success: false,
        error: "MISSING_REDIRECT_URI",
        message:
          "Send redirect_uri in query param or configure TIKTOK_REDIRECT_URI in backend env.",
      },
      { status: 400 }
    );
  }

  const { state, codeChallenge } = createTikTokLinkState(discordId);
  const scopes = getRequiredTikTokScopes();
  const authUrl = getTikTokAuthUrl({
    redirectUri,
    state,
    codeChallenge,
    scopes,
  });

  return NextResponse.json({
    success: true,
    data: {
      auth_url: authUrl,
      state,
      redirect_uri: redirectUri,
      scopes,
    },
  });
}
