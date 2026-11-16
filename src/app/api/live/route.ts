import { NextResponse } from "next/server";

import { getLivePlatforms } from "@/app/utils/live/status";

// Estado del directo en Kick y en Twitch (lo consume el front con su bearer).
export async function GET() {
  return NextResponse.json({ success: true, result: await getLivePlatforms() });
}
