import { createUser } from "@/app/utils/users";

import { NextRequest, NextResponse } from "next/server";

import { z } from "zod";

const bodySchema = z.object({
  username: z.string().min(3).max(100),
  kick_id: z.string().min(3).max(100),
  email: z.email(),
  image: z.string(),
});

export async function POST(request: NextRequest) {
  let body;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "INVALID_REQUEST_BODY", details: error },
        { status: 400 }
      );
    } else {
      return NextResponse.json(
        { error: "INTERNAL_SERVER_ERROR" },
        { status: 500 }
      );
    }
  }

  const user = await createUser({
    name: body.username,
    user_id: body.kick_id,
    profile_picture: body.image,
    email: body.email,
  });

  if (!user) {
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      success: true,
      data: user,
    },
    {
      status: 200,
    }
  );
}
