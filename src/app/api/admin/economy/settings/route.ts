import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { DEFAULT_ECONOMY_SETTINGS } from "@/app/utils/economy/schema";
import { getEconomySettings, saveEconomySettings } from "@/app/utils/economy/settings";

export async function GET() {
  if (!(await requireAdmin())) return adminUnauthorized();

  return NextResponse.json({
    success: true,
    data: { settings: await getEconomySettings(), defaults: DEFAULT_ECONOMY_SETTINGS },
  });
}

export async function PUT(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const body = await request.json().catch(() => null);

  try {
    const result = await saveEconomySettings(body);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: "INVALID_SETTINGS", issues: result.issues },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true, data: { settings: result.settings } });
  } catch (error) {
    console.error("Error saving economy settings:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
