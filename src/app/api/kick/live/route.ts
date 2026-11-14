import { NextResponse } from "next/server";

import { getLiveStatus } from "@/app/utils/kick/live";

export async function GET() {
  return NextResponse.json({
    success: true,
    result: await getLiveStatus(),
  });
}
