import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { setUserBannedStatusById } from "@/app/utils/users";

const bodySchema = z.object({
  is_banned: z.boolean(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const userId = Number(idParam);

    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json(
        { success: false, error: "INVALID_USER_ID" },
        { status: 400 }
      );
    }

    const body = bodySchema.parse(await request.json());
    const user = await setUserBannedStatusById(userId, body.is_banned);

    if (!user) {
      return NextResponse.json(
        { success: false, error: "USER_NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "INVALID_REQUEST_BODY", details: error.flatten() },
        { status: 400 }
      );
    }

    console.error("Error updating user ban status:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}