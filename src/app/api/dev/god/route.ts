import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ensureGodUser, isGodMode, prepareGodBoxes } from "@/app/utils/dev/godMode";

// MODO DIOS (solo desarrollo local). Además del bearer del API que exige
// `src/proxy.ts`, fuera del modo dios esta ruta no existe: 404 antes de nada.
// No recibe ningún id: siempre actúa sobre el usuario de pruebas fijo.

const bodySchema = z.object({
  action: z.enum(["ensure", "refill", "boxes"]),
});

const notFound = () =>
  NextResponse.json({ success: false, error: "NOT_FOUND" }, { status: 404 });

export async function POST(request: NextRequest) {
  if (!isGodMode()) return notFound();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "INVALID_REQUEST_BODY" },
      { status: 400 }
    );
  }

  try {
    switch (parsed.data.action) {
      case "ensure": {
        const user = await ensureGodUser();
        return NextResponse.json({ success: true, data: { balance: user.balance } });
      }
      case "refill": {
        const user = await ensureGodUser({ refill: true });
        return NextResponse.json({ success: true, data: { balance: user.balance } });
      }
      case "boxes": {
        const boxes = await prepareGodBoxes();
        return NextResponse.json({ success: true, data: boxes });
      }
    }
  } catch (error) {
    console.error("[god-mode] error:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}

export function GET() {
  return notFound();
}
