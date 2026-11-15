import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { disconnectStreamer } from "@/app/utils/live/connections";

import { parsePlatform } from "./platform";

// Desconecta la cuenta del streamer (borra tokens y suscripciones).
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const platform = parsePlatform((await params).platform);
  if (!platform) return NextResponse.json({ success: false, error: "INVALID_PLATFORM" }, { status: 400 });

  try {
    await disconnectStreamer(platform);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error disconnecting streamer account:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
