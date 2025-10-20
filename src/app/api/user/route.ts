import { getUserByDiscordId } from "@/app/utils/users";
import { NextResponse } from "next/server";

import { z } from "zod";

const bodySchema = z.object({
  discord_id: z.number(),
});

export async function POST(request: Request) {
  let body;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request body", details: error },
        { status: 400 }
      );
    } else {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
  }

  const { discord_id } = body;

  const user = await getUserByDiscordId(discord_id.toString());

  if (!user) {
    return NextResponse.json(
      { success: false, error: "USER_NOT_FOUND" },
      { status: 404 }
    );
  }

  return NextResponse.json(
    {
      success: true,
      message: "User retrieved successfully",
      data: user,
    },
    {
      status: 200,
    }
  );
}
