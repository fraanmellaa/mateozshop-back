import { NextRequest, NextResponse } from "next/server";
import { finishGiveaway } from "@/app/utils/giveaways/admin";

export async function POST(
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

    const giveaway = await finishGiveaway(id);

    if (!giveaway) {
      return NextResponse.json(
        { error: "Sorteo no encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Sorteo finalizado correctamente",
      giveaway,
    });
  } catch (error) {
    console.error("Error finishing giveaway:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
