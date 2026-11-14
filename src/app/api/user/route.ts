import { getUserByDiscordId, toPublicUser } from "@/app/utils/users";
import { NextResponse } from "next/server";

import { z } from "zod";

const bodySchema = z.object({
  discord_id: z.string().min(1).max(100),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "INVALID_REQUEST_BODY" },
      { status: 400 }
    );
  }

  const user = await getUserByDiscordId(parsed.data.discord_id);

  if (!user) {
    return NextResponse.json(
      { success: false, error: "USER_NOT_FOUND" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: toPublicUser(user) });
}
