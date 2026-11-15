import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { ConnectionError, subscribePlatform } from "@/app/utils/live/connections";

import { parsePlatform } from "../platform";

// Reintenta (o comprueba) las suscripciones a los eventos de la plataforma.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const platform = parsePlatform((await params).platform);
  if (!platform) return NextResponse.json({ success: false, error: "INVALID_PLATFORM" }, { status: 400 });

  try {
    await subscribePlatform(platform);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ConnectionError) {
      return NextResponse.json({ success: false, error: error.code }, { status: 409 });
    }
    console.error("Error retrying subscriptions:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
