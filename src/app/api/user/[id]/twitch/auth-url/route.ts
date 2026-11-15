import { NextRequest, NextResponse } from "next/server";

import { createTwitchAuthUrl } from "@/app/utils/twitch/oauth";
import { getUserByDiscordId } from "@/app/utils/users";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: discordId } = await params;

  const user = await getUserByDiscordId(discordId);
  if (!user) {
    return NextResponse.json({ success: false, error: "USER_NOT_FOUND" }, { status: 404 });
  }

  if (user.twitch_id) {
    return NextResponse.json({ success: false, error: "TWITCH_ALREADY_LINKED" }, { status: 409 });
  }

  return NextResponse.json({
    success: true,
    data: { auth_url: await createTwitchAuthUrl(discordId) },
  });
}
