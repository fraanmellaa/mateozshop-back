import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { VipUnavailableError } from "@/app/utils/points/vip";
import { getProofImage } from "@/app/utils/verification";

// Captura de una solicitud pendiente (?kind=welcome|deposit). Solo con sesión
// de admin y sin caché: las capturas no tienen URL pública en ningún momento.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const { id } = await params;
  const requestId = Number(id);
  const kind = request.nextUrl.searchParams.get("kind");
  if (!Number.isInteger(requestId) || requestId <= 0 || (kind !== "welcome" && kind !== "deposit")) {
    return NextResponse.json({ success: false, error: "INVALID_REQUEST" }, { status: 400 });
  }

  try {
    const image = await getProofImage(requestId, kind);
    if (!image) return NextResponse.json({ success: false, error: "PROOF_NOT_FOUND" }, { status: 404 });
    return new NextResponse(image.bytes, {
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    if (error instanceof VipUnavailableError) {
      return NextResponse.json({ success: false, error: "VIP_UNAVAILABLE" }, { status: 409 });
    }
    console.error("Error reading verification proof:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
