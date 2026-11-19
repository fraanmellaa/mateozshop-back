import { NextRequest, NextResponse } from "next/server";
import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { updateGiveaway, deleteGiveaway } from "@/app/utils/giveaways/admin";
import { isValidTicketCost } from "@/app/utils/giveaways/tickets";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    const body = await request.json();
    const {
      title,
      image,
      cost,
      start_at,
      end_at,
      sendable,
      codes,
      used_codes,
      rules,
    } = body;

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID de sorteo inválido" },
        { status: 400 }
      );
    }

    const updateData: {
      title?: string;
      image?: string;
      cost?: number;
      start_at?: number;
      end_at?: number;
      sendable?: boolean;
      codes?: string[];
      used_codes?: string[];
      rules?: string | null;
    } = {};

    if (title) updateData.title = title;
    if (image) updateData.image = image;
    if (cost !== undefined && cost !== null && cost !== "") {
      // Entero de 1 en adelante: nunca negativo, cero ni con decimales.
      if (!isValidTicketCost(cost)) {
        return NextResponse.json(
          { error: "El coste del ticket debe ser un número entero de puntos, de 1 en adelante" },
          { status: 400 }
        );
      }
      updateData.cost = parseInt(cost);
    }
    if (start_at) updateData.start_at = parseInt(start_at);
    if (end_at) updateData.end_at = parseInt(end_at);
    if (sendable !== undefined) {
      updateData.sendable = Boolean(sendable);
      if (sendable && codes) {
        updateData.codes = codes;
      }
    }
    if (codes !== undefined) updateData.codes = codes;
    if (used_codes !== undefined) updateData.used_codes = used_codes;
    if (rules !== undefined) {
      if (rules !== null && (typeof rules !== "string" || rules.length > 10000)) {
        return NextResponse.json(
          { error: "Las bases deben ser un texto de hasta 10000 caracteres" },
          { status: 400 }
        );
      }
      updateData.rules = typeof rules === "string" && rules.trim() ? rules.trim() : null;
    }

    if (
      updateData.start_at &&
      updateData.end_at &&
      updateData.start_at >= updateData.end_at
    ) {
      return NextResponse.json(
        { error: "La fecha de inicio debe ser anterior a la fecha de fin" },
        { status: 400 }
      );
    }

    if (
      updateData.sendable &&
      updateData.codes &&
      updateData.codes.length === 0
    ) {
      return NextResponse.json(
        { error: "Si el sorteo es enviable, debe proporcionar códigos" },
        { status: 400 }
      );
    }

    const giveaway = await updateGiveaway(id, updateData);

    if (!giveaway) {
      return NextResponse.json(
        { error: "Sorteo no encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json(giveaway);
  } catch (error) {
    if (error instanceof Error && error.message === "RULES_LOCKED") {
      return NextResponse.json(
        { error: "Las bases no se pueden cambiar una vez hecho el sorteo" },
        { status: 409 }
      );
    }
    console.error("Error updating giveaway:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID de sorteo inválido" },
        { status: 400 }
      );
    }

    await deleteGiveaway(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting giveaway:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
