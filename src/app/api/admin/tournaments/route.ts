import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { createTournament, listTournaments } from "@/app/utils/games/tournament";

const bodySchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    startAt: z.number().int().positive(),
    endAt: z.number().int().positive(),
    prizes: z
      .array(
        z.object({
          place: z.number().int().min(1).max(3),
          reward: z.string().trim().min(1).max(200),
        })
      )
      .min(1)
      .max(3),
  })
  .refine((v) => v.endAt > v.startAt, { message: "La fecha de fin debe ser posterior a la de inicio" })
  .refine((v) => v.endAt - v.startAt <= 60 * 86400, { message: "Un torneo no puede durar más de 60 días" })
  .refine((v) => new Set(v.prizes.map((p) => p.place)).size === v.prizes.length, {
    message: "Hay puestos repetidos en los premios",
  });

export async function GET() {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    return NextResponse.json({ success: true, data: { tournaments: await listTournaments() } });
  } catch (error) {
    console.error("Error listing tournaments:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "INVALID_REQUEST_BODY",
        message: parsed.error.issues[0]?.message ?? "Datos no válidos",
      },
      { status: 400 }
    );
  }

  try {
    const id = await createTournament(parsed.data);
    return NextResponse.json({ success: true, data: { id } }, { status: 201 });
  } catch (error) {
    console.error("Error creating tournament:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
