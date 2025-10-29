import { NextRequest, NextResponse } from "next/server";
import { sendWinnerEmail } from "@/app/utils/giveaways";

// POST /api/admin/giveaways/[id]/send-winner-email - Enviar email al ganador
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

    const body = await request.json();
    const { winnerId, subject, message } = body;

    if (!winnerId) {
      return NextResponse.json(
        { error: "Winner ID es requerido" },
        { status: 400 }
      );
    }

    await sendWinnerEmail(id, winnerId, subject, message);

    return NextResponse.json({
      success: true,
      message: "Email enviado al ganador correctamente",
    });
  } catch (error) {
    console.error("Error sending winner email:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Error interno del servidor",
      },
      { status: 500 }
    );
  }
}
