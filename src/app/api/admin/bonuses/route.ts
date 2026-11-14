import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { createBonus, getAllBonuses } from "@/app/utils/bonuses";
import { countryListsOverlap, createBonusSchema } from "@/app/utils/bonuses/schema";
import { purgeBonusesCache } from "@/app/utils/frontendCache";

export async function GET() {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const result = await getAllBonuses();
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Error fetching bonuses:", error);
    return NextResponse.json(
      { success: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const body = await request.json().catch(() => null);
  const parsed = createBonusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: parsed.error.issues[0]?.message || "Datos no válidos",
      },
      { status: 400 }
    );
  }

  const overlap = countryListsOverlap(parsed.data);
  if (overlap) {
    return NextResponse.json({ success: false, error: overlap }, { status: 400 });
  }

  try {
    const bonus = await createBonus(parsed.data);
    await purgeBonusesCache().catch(() => null);
    return NextResponse.json({ success: true, data: bonus }, { status: 201 });
  } catch (error) {
    console.error("Error creating bonus:", error);
    return NextResponse.json(
      { success: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
