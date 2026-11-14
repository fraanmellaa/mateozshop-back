import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { getExtensionSettings, saveExtensionSettings } from "@/app/utils/settings";
import { DEFAULT_EXTENSION_SETTINGS } from "@/app/utils/settings/schema";

export async function GET() {
  if (!(await requireAdmin())) return adminUnauthorized();

  return NextResponse.json({
    success: true,
    data: {
      settings: await getExtensionSettings(),
      defaults: DEFAULT_EXTENSION_SETTINGS,
    },
  });
}

export async function PUT(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const body = await request.json().catch(() => null);

  try {
    const result = await saveExtensionSettings(body);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: "INVALID_SETTINGS", issues: result.issues },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true, data: { settings: result.settings } });
  } catch (error) {
    console.error("Error saving extension settings:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
