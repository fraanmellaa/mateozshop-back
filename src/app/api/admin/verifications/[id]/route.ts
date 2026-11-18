import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { VipUnavailableError } from "@/app/utils/points/vip";
import { VIP_MIGRATION_ERROR } from "@/app/utils/products/currency";
import { VerificationError, reviewVerification, revokeVerification } from "@/app/utils/verification";

const bodySchema = z.union([
  z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() }),
  z.object({ revoke: z.literal(true), note: z.string().trim().max(300).optional() }),
]);

// Aprueba (verifica al usuario) o rechaza una solicitud pendiente, o retira una
// verificación ya aprobada (`revoke`). Al resolver se borran las capturas.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return adminUnauthorized();

  const { id } = await params;
  const requestId = Number(id);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!Number.isInteger(requestId) || requestId <= 0 || !parsed.success) {
    return NextResponse.json({ success: false, error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

  try {
    const body = parsed.data;
    const result =
      "revoke" in body
        ? await revokeVerification(requestId, admin.username, body.note || null)
        : await reviewVerification(requestId, body.approve, admin.username, body.note || null);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof VipUnavailableError) {
      return NextResponse.json(
        { success: false, error: "VIP_UNAVAILABLE", message: VIP_MIGRATION_ERROR },
        { status: 409 }
      );
    }
    if (error instanceof VerificationError) {
      return NextResponse.json(
        { success: false, error: error.code },
        { status: error.code === "REQUEST_NOT_FOUND" ? 404 : 400 }
      );
    }
    console.error("Error reviewing verification request:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
