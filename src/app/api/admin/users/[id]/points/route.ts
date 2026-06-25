import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  addPointsToUserById,
  removeAvailablePointsFromUserById,
  resetUserPointsById,
} from "@/app/utils/users";

const bodySchema = z.object({
  action: z.enum(["add", "remove", "reset"]),
  amount: z.number().int().positive().optional(),
});

export async function POST(
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

    let user = null;

    if (body.action === "add") {
      user = await addPointsToUserById(userId, Number(body.amount || 0));
    } else if (body.action === "remove") {
      user = await removeAvailablePointsFromUserById(
        userId,
        Number(body.amount || 0)
      );
    } else {
      user = await resetUserPointsById(userId);
    }

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

    if (
      error instanceof Error &&
      error.message === "INSUFFICIENT_AVAILABLE_POINTS"
    ) {
      return NextResponse.json(
        { success: false, error: "INSUFFICIENT_AVAILABLE_POINTS" },
        { status: 400 }
      );
    }

    console.error("Error updating admin user points:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}