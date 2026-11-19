import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { adMonth } from "@/app/utils/economy/time";
import {
  getTikTokMonthPrizes,
  grantTikTokMonthPrize,
  isValidMonth,
  TikTokPrizeError,
} from "@/app/utils/tiktok/monthPrizes";

/** GET /api/admin/tiktok/month-prizes?month=YYYY-MM: premios y ganadores del mes. */
export async function GET(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const raw = request.nextUrl.searchParams.get("month");
  const month = isValidMonth(raw) ? raw : adMonth();
  try {
    return NextResponse.json({ success: true, data: await getTikTokMonthPrizes(month) });
  } catch (error) {
    console.error("Error loading TikTok month prizes:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}

/** POST: el administrador marca a mano al ganador de un puesto y se le abonan los puntos. */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return adminUnauthorized();

  const body = await request.json().catch(() => null);
  try {
    const data = await grantTikTokMonthPrize({
      month: String(body?.month ?? ""),
      place: Number(body?.place),
      user: String(body?.user ?? ""),
      admin: admin.username,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof TikTokPrizeError) {
      return NextResponse.json({ success: false, error: error.code }, { status: 400 });
    }
    console.error("Error granting TikTok month prize:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
