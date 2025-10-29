import { NextRequest, NextResponse } from "next/server";
import { sendWinnerEmail } from "@/app/utils/giveaways";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const params = await context.params;
    const giveawayId = parseInt(params.id);

    const body = await request.json();
    const { winnerId, subject, message } = body;

    if (!winnerId) {
      return NextResponse.json(
        { error: "Winner ID es requerido" },
        { status: 400 }
      );
    }

    await sendWinnerEmail(giveawayId, winnerId, subject, message);

    return NextResponse.json(
      { message: "Email enviado exitosamente" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error sending winner email:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
