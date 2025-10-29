import { NextRequest, NextResponse } from "next/server";
import { addGiveawayComment } from "@/app/utils/giveaways";

// POST /api/admin/giveaways/[id]/comment - Agregar comentario
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

    const { message } = await request.json();

    if (!message || message.trim() === "") {
      return NextResponse.json(
        { error: "El comentario no puede estar vacío" },
        { status: 400 }
      );
    }

    const result = await addGiveawayComment(id, message.trim());

    return NextResponse.json({
      success: true,
      message: "Comentario agregado correctamente",
      comment: result.comment,
    });
  } catch (error) {
    console.error("Error adding comment:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
