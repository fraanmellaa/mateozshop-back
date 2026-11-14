import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { sendCustomEmail } from "@/app/utils/email";
import { markOpeningDelivered } from "@/app/utils/lootBoxes";
import { adminErrorResponse, invalidId, parseId, readJson } from "@/app/utils/lootBoxes/http";

const bodySchema = z.object({
  status: z.literal("delivered", { error: 'El único estado permitido es "delivered"' }),
  delivery_note: z
    .union([z.string().max(500, "La nota admite 500 caracteres como máximo"), z.null()])
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const openingId = parseId((await params).id);
  if (!openingId) return invalidId();

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "VALIDATION_ERROR",
        message: parsed.error.issues.map((i) => i.message).join(". "),
      },
      { status: 400 }
    );
  }

  try {
    const { opening, changed } = await markOpeningDelivered(openingId, parsed.data.delivery_note);

    // Solo en la transición real; el aviso es de mejor esfuerzo y no revierte la entrega.
    if (changed && opening.user?.email) {
      try {
        const lines = [`Tu premio "${opening.prize_name}" ya ha sido entregado.`];
        if (opening.delivery_note) lines.push("", `Nota: ${opening.delivery_note}`);
        const sent = await sendCustomEmail(
          opening.user.email,
          "Tu premio de caja ha sido entregado",
          lines.join("\n")
        );
        if (!sent) console.error(`Loot box opening ${opening.id}: delivery email could not be sent`);
      } catch (error) {
        console.error(`Loot box opening ${opening.id}: delivery email failed`, error);
      }
    }

    return NextResponse.json({ success: true, result: opening });
  } catch (error) {
    return adminErrorResponse(error, "Error marking opening as delivered");
  }
}
