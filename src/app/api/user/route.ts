import { getUserByKickId } from "@/app/utils/users";
import { NextResponse } from "next/server";

import { z } from "zod";

const bodySchema = z.object({
  kick_id: z.string(),
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

  const { kick_id } = body;

  const user = await getUserByKickId(kick_id);

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
