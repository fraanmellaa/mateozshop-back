import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { VipUnavailableError } from "@/app/utils/points/vip";
import { VIP_MIGRATION_ERROR } from "@/app/utils/products/currency";
import { listVerificationRequests, type VerificationStatus } from "@/app/utils/verification";

const STATUSES: VerificationStatus[] = ["pending", "approved", "rejected", "revoked"];

// Solicitudes de verificación para el panel (?status=pending|approved|rejected).
export async function GET(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const status = request.nextUrl.searchParams.get("status");
  try {
    const requests = await listVerificationRequests(
      STATUSES.includes(status as VerificationStatus) ? (status as VerificationStatus) : undefined
    );
    return NextResponse.json({ success: true, data: requests });
  } catch (error) {
    if (error instanceof VipUnavailableError) {
      return NextResponse.json(
        { success: false, error: "VIP_UNAVAILABLE", message: VIP_MIGRATION_ERROR },
        { status: 409 }
      );
    }
    console.error("Error listing verification requests:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
