import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { getAdminOpenings, type OpeningStatus } from "@/app/utils/lootBoxes";
import { adminErrorResponse } from "@/app/utils/lootBoxes/http";

const STATUSES: OpeningStatus[] = ["pending", "delivered", "completed"];

export async function GET(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const params = request.nextUrl.searchParams;
  const rawStatus = params.get("status");
  if (rawStatus && !STATUSES.includes(rawStatus as OpeningStatus)) {
    return NextResponse.json(
      { success: false, error: "VALIDATION_ERROR", message: "Estado no válido." },
      { status: 400 }
    );
  }
  const page = Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1);

  try {
    const { result, has_more } = await getAdminOpenings(
      rawStatus ? (rawStatus as OpeningStatus) : null,
      page,
      params.get("kind") === "item" ? "item" : null
    );
    return NextResponse.json({ success: true, result, page, has_more });
  } catch (error) {
    return adminErrorResponse(error, "Error fetching loot box openings");
  }
}
