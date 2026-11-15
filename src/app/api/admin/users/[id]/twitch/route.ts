import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { unlinkTwitchAccount } from "@/app/utils/users";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const { id: idParam } = await params;
    const userId = Number(idParam);

    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ success: false, error: "INVALID_USER_ID" }, { status: 400 });
    }

    const user = await unlinkTwitchAccount(userId);
    if (!user) {
      return NextResponse.json({ success: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("Error unlinking Twitch account:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
