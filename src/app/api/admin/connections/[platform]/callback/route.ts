import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { ConnectionError, completeStreamerConnection } from "@/app/utils/live/connections";

import { parsePlatform } from "../platform";

export const dynamic = "force-dynamic";

// Vuelta del OAuth del streamer. Exige la sesión de admin: el redirect llega con la cookie.
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const platform = parsePlatform((await params).platform);
  if (!platform) return NextResponse.json({ success: false, error: "INVALID_PLATFORM" }, { status: 400 });

  const back = new URL("/connections", request.url);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (request.nextUrl.searchParams.get("error") || !code || !state) {
    back.searchParams.set("error", "AUTHORIZATION_DENIED");
    return NextResponse.redirect(back);
  }

  try {
    await completeStreamerConnection(platform, code, state);
    back.searchParams.set("connected", platform);
  } catch (error) {
    if (!(error instanceof ConnectionError)) console.error("Streamer connection failed:", error);
    back.searchParams.set("error", error instanceof ConnectionError ? error.code : "INTERNAL_SERVER_ERROR");
  }
  return NextResponse.redirect(back);
}
