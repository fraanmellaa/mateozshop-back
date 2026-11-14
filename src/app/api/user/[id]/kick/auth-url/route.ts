import { NextRequest, NextResponse } from "next/server";

import { createKickAuthUrl } from "@/app/utils/kick/oauth";
import { getUserByDiscordId } from "@/app/utils/users";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: discordId } = await params;

  const user = await getUserByDiscordId(discordId);
  if (!user) {
    return NextResponse.json(
      { success: false, error: "USER_NOT_FOUND" },
      { status: 404 }
    );
  }

  if (user.kick_id) {
    return NextResponse.json(
      { success: false, error: "KICK_ALREADY_LINKED" },
      { status: 409 }
    );
  }

  return NextResponse.json({
    success: true,
    data: { auth_url: await createKickAuthUrl(discordId) },
  });
}
