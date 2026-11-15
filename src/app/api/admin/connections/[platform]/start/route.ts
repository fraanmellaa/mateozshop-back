import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { createStreamerAuthUrl, missingEnv } from "@/app/utils/live/connections";

import { parsePlatform } from "../platform";

export const dynamic = "force-dynamic";

// Navegación del navegador (con la cookie de admin): redirige a la plataforma.
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const platform = parsePlatform((await params).platform);
  if (!platform) return NextResponse.json({ success: false, error: "INVALID_PLATFORM" }, { status: 400 });

  const missing = missingEnv(platform);
  if (missing.length > 0) {
    const url = new URL("/connections", request.url);
    url.searchParams.set("error", `MISSING_ENV:${missing.join(",")}`);
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(await createStreamerAuthUrl(platform));
}
