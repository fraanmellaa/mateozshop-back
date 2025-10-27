import { NextRequest, NextResponse } from "next/server";
import { performGiveawayLottery } from "@/app/utils/giveaways/lottery";

/**
 * POST /api/giveaways/[id]/lottery
 * Realiza el sorteo para un giveaway específico
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const id = resolvedParams.id;

    if (isNaN(parseInt(id))) {
      return NextResponse.json(
        {
          success: false,
          error: "ID de sorteo inválido",
        },
        { status: 400 }
      );
    }

    const result = await performGiveawayLottery(parseInt(id));

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: `Sorteo completado exitosamente`,
        result,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error al realizar sorteo:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Error interno del servidor",
      },
      { status: 500 }
    );
  }
}
