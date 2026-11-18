import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { PointsError } from "@/app/utils/points";
import { VipUnavailableError } from "@/app/utils/points/vip";
import { VIP_MIGRATION_ERROR } from "@/app/utils/products/currency";
import {
  addVipPointsToUserById,
  removeVipPointsFromUserById,
  setUserVerifiedById,
} from "@/app/utils/users";

const amountSchema = z.number().int().positive().max(1_000_000_000);

// Verificar a un usuario y darle o quitarle puntos VIP a mano.
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), verified: z.boolean() }),
  z.object({ action: z.literal("add"), amount: amountSchema }),
  z.object({ action: z.literal("remove"), amount: amountSchema }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return adminUnauthorized();

  try {
    const { id: idParam } = await params;
    const userId = Number(idParam);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ success: false, error: "INVALID_USER_ID" }, { status: 400 });
    }

    const body = bodySchema.parse(await request.json());

    const user =
      body.action === "verify"
        ? await setUserVerifiedById(userId, body.verified, admin.username)
        : body.action === "add"
          ? await addVipPointsToUserById(userId, body.amount)
          : await removeVipPointsFromUserById(userId, body.amount);

    if (!user) {
      return NextResponse.json({ success: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ success: true, user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "INVALID_REQUEST_BODY", details: z.flattenError(error) },
        { status: 400 }
      );
    }
    if (error instanceof VipUnavailableError) {
      return NextResponse.json(
        { success: false, error: "VIP_UNAVAILABLE", message: VIP_MIGRATION_ERROR },
        { status: 409 }
      );
    }
    if (error instanceof PointsError) {
      return NextResponse.json(
        { success: false, error: error.code },
        { status: error.code === "USER_NOT_FOUND" ? 404 : 400 }
      );
    }
    console.error("Error updating admin user VIP:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
