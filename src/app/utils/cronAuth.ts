import { NextRequest, NextResponse } from "next/server";

import { safeEqual } from "@/lib/env";

/**
 * Autoriza una ruta de /api/cron. Vercel Cron envía
 * `Authorization: Bearer ${CRON_SECRET}`. Sin la variable, la ruta queda
 * cerrada (no abierta).
 */
export function requireCron(request: NextRequest | Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error("CRON_SECRET is not configured: cron route refused");
    return NextResponse.json(
      { success: false, error: "CRON_NOT_CONFIGURED" },
      { status: 500 }
    );
  }

  if (!safeEqual(request.headers.get("authorization"), `Bearer ${secret}`)) {
    return NextResponse.json(
      { success: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  return null;
}
