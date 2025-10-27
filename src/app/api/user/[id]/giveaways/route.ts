import { getUserGiveaways } from "@/app/utils/giveaways";
import { getUserByDiscordId } from "@/app/utils/users";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const discord_id = resolvedParams.id;

  const user = await getUserByDiscordId(discord_id);

  if (!user) {
    return NextResponse.json(
      { success: false, error: "USER_NOT_FOUND" },
      { status: 404 }
    );
  }

  const giveaways = await getUserGiveaways(user.id);

  return NextResponse.json(
    {
      success: true,
      data: giveaways,
    },
    {
      status: 200,
    }
  );
}
