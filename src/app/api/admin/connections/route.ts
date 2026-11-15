import { NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { listConnectionStatus } from "@/app/utils/live/connections";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    return NextResponse.json({ success: true, data: await listConnectionStatus() });
  } catch (error) {
    console.error("Error reading streamer connections:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
