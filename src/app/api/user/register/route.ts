import { createUser, toPublicUser } from "@/app/utils/users";

import { NextRequest, NextResponse } from "next/server";

import { z } from "zod";

const bodySchema = z.object({
  // Los nombres visibles de Discord pueden tener 1 o 2 caracteres.
  name: z.string().trim().min(1).max(100),
  discord_id: z.string().min(3).max(100),
  email: z.email(),
  avatar: z.string(),
});

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "INVALID_REQUEST_BODY",
        details: z.flattenError(parsed.error),
      },
      { status: 400 }
    );
  }

  const body = parsed.data;

  try {
    const user = await createUser({
      name: body.name,
      user_id: body.discord_id,
      profile_picture: body.avatar,
      email: body.email,
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: "INTERNAL_SERVER_ERROR" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: toPublicUser(user) });
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_ALREADY_REGISTERED") {
      return NextResponse.json(
        { success: false, error: "EMAIL_ALREADY_REGISTERED" },
        { status: 409 }
      );
    }

    console.error("Error registering user:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
