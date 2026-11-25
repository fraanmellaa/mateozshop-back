import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { reorderBonuses } from "@/app/utils/bonuses";
import { purgeBonusesCache } from "@/app/utils/frontendCache";

const orderSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) });

/** Orden de los casinos en la web (panel de Bonos, arrastrando filas). */
export async function PUT(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const parsed = orderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Orden no válido" }, { status: 400 });
  }

  try {
    await reorderBonuses(parsed.data.ids);
    await purgeBonusesCache().catch(() => null);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reordering bonuses:", error);
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 });
  }
}
