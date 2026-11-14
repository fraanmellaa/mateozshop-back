import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { PointsError } from "@/app/utils/points";
import {
  addPointsToUserById,
  removeAvailablePointsFromUserById,
  resetUserPointsById,
} from "@/app/utils/users";

const amountSchema = z.number().int().positive().max(1_000_000_000);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), amount: amountSchema }),
  z.object({ action: z.literal("remove"), amount: amountSchema }),
  z.object({ action: z.literal("reset") }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

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
      user = await addPointsToUserById(userId, body.amount);
    } else if (body.action === "remove") {
      user = await removeAvailablePointsFromUserById(userId, body.amount);
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
        {
          success: false,
          error: "INVALID_REQUEST_BODY",
          details: z.flattenError(error),
        },
        { status: 400 }
      );
    }

    if (error instanceof PointsError) {
      return NextResponse.json(
        { success: false, error: error.code },
        { status: error.code === "USER_NOT_FOUND" ? 404 : 400 }
      );
    }

    console.error("Error updating admin user points:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
