import { NextRequest, NextResponse } from "next/server";
import { updateGiveaway, deleteGiveaway } from "@/app/utils/giveaways/admin";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    } = {};

    if (title) updateData.title = title;
    if (image) updateData.image = image;
    if (cost) updateData.cost = parseInt(cost);
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
