import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fetchKickIdentity, verifyKickState } from "@/app/utils/kick/oauth";
import {
  KickLinkError,
  getUserByDiscordId,
  linkKickAccount,
} from "@/app/utils/users";

const bodySchema = z.object({
  code: z.string().min(1).max(2000),
  state: z.string().min(10).max(2000),
});

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: discordId } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("INVALID_REQUEST_BODY", 400);

  const user = await getUserByDiscordId(discordId);
  if (!user) return fail("USER_NOT_FOUND", 404);
  if (user.kick_id) return fail("KICK_ALREADY_LINKED", 409);

  const codeVerifier = await verifyKickState(parsed.data.state, discordId);
  if (!codeVerifier) return fail("INVALID_STATE", 400);

  let identity;
  try {
    identity = await fetchKickIdentity(parsed.data.code, codeVerifier);
  } catch (error) {
    console.error("Kick OAuth failed:", error);
    return fail("KICK_OAUTH_FAILED", 502);
  }

  try {
    const linked = await linkKickAccount(
      user.id,
      identity.kick_id,
      identity.kick_username
    );
    if (!linked) return fail("USER_NOT_FOUND", 404);
  } catch (error) {
    if (error instanceof KickLinkError) return fail(error.code, 409);
    throw error;
  }

  return NextResponse.json({ success: true, data: identity });
}
