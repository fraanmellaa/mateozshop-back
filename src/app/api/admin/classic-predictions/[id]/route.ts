import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import {
  cancelClassicPrediction,
  lockClassicPrediction,
  resolveClassicPrediction,
} from "@/app/utils/classicPredictions";
import { classicAdminActionSchema } from "@/app/utils/classicPredictions/schema";

import { badId, fail, invalid, parseId } from "../shared";

type Params = { params: Promise<{ id: string }> };

// Acciones sobre una predicción (Classic): cerrar la votación (`lock`), dar el
// resultado y repartir el bote (`resolve` con `winner`: a | b) o anularla y
// devolver los puntos (`cancel`).
export async function POST(request: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (!admin) return adminUnauthorized();

  const id = parseId((await params).id);
  if (id === null) return badId();

  const parsed = classicAdminActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);

  try {
    const action = parsed.data;
    if (action.action === "lock") {
      await lockClassicPrediction(id, admin.username);
      return NextResponse.json({ success: true });
    }
    if (action.action === "cancel") {
      return NextResponse.json({ success: true, data: await cancelClassicPrediction(id, admin.username) });
    }
    return NextResponse.json({
      success: true,
      data: await resolveClassicPrediction(id, action.winner, admin.username),
    });
  } catch (error) {
    return fail(error, "Error updating classic prediction");
  }
}
