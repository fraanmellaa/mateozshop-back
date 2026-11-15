import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fetchTwitchIdentity, verifyTwitchState } from "@/app/utils/twitch/oauth";
import { TwitchLinkError, getUserByDiscordId, linkTwitchAccount } from "@/app/utils/users";

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
  if (user.twitch_id) return fail("TWITCH_ALREADY_LINKED", 409);

  if (!(await verifyTwitchState(parsed.data.state, discordId))) return fail("INVALID_STATE", 400);

  let identity;
  try {
    identity = await fetchTwitchIdentity(parsed.data.code);
  } catch (error) {
    console.error("Twitch OAuth failed:", error);
    return fail("TWITCH_OAUTH_FAILED", 502);
  }

  try {
    const linked = await linkTwitchAccount(user.id, {
      id: identity.twitch_id,
      username: identity.twitch_username,
      createdAt: identity.twitch_created_at,
    });
    if (!linked) return fail("USER_NOT_FOUND", 404);
  } catch (error) {
    if (error instanceof TwitchLinkError) return fail(error.code, 409);
    throw error;
  }

  return NextResponse.json({
    success: true,
    data: { twitch_id: identity.twitch_id, twitch_username: identity.twitch_username },
  });
}
