import { NextRequest, NextResponse } from "next/server";
import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { sendWinnerEmail, SendWinnerEmailError } from "@/app/utils/giveaways/admin";

const ERRORS: Record<SendWinnerEmailError, { status: number; message: string }> = {
  GIVEAWAY_NOT_FOUND: { status: 404, message: "Sorteo no encontrado" },
  NOT_THE_WINNER: { status: 400, message: "Ese usuario no es el ganador del sorteo" },
  WINNER_WITHOUT_EMAIL: { status: 409, message: "El ganador no tiene email" },
  EMAIL_NOT_SENT: { status: 502, message: "No se pudo enviar el email" },
};

// POST /api/admin/giveaways/[id]/send-winner-email - Enviar email al ganador
export async function POST(
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

    const body = await request.json().catch(() => null);
    const winnerId = Number(body?.winnerId);
    const subject = typeof body?.subject === "string" ? body.subject : undefined;
    const message = typeof body?.message === "string" ? body.message : undefined;

    if (!Number.isInteger(winnerId) || winnerId <= 0) {
      return NextResponse.json(
        { error: "Winner ID es requerido" },
        { status: 400 }
      );
    }

    const result = await sendWinnerEmail(id, winnerId, subject, message);

    if (!result.success) {
      const { status, message: errorMessage } = ERRORS[result.error];
      return NextResponse.json({ error: errorMessage }, { status });
    }

    return NextResponse.json({
      success: true,
      message: "Email enviado al ganador correctamente",
    });
  } catch (error) {
    console.error("Error sending winner email:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
