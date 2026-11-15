import { NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { runMonthlyReset } from "@/app/utils/economy/monthly";

export const maxDuration = 300;

/** Lanza el reinicio mensual ahora (solo si el mes en curso no está hecho). */
export async function POST() {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const result = await runMonthlyReset({ force: true });
    const ok = result.status === "done" || result.status === "already_done";
    return NextResponse.json({ success: ok, data: result }, { status: ok ? 200 : 409 });
  } catch (error) {
    console.error("Error running monthly reset:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
