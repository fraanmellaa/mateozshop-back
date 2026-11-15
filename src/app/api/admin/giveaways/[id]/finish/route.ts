import { NextRequest, NextResponse } from "next/server";
import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { purgePastGiveawaysCache } from "@/app/utils/frontendCache";
import { finishGiveaway } from "@/app/utils/giveaways/admin";
import { performGiveawayLottery } from "@/app/utils/giveaways/lottery";

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

    const giveaway = await finishGiveaway(id);

    if (!giveaway) {
      return NextResponse.json(
        { error: "Sorteo no encontrado o ya cerrado" },
        { status: 404 }
      );
    }

    // Cierre manual: se sortea ya (idempotente; el cron no repetirá el sorteo).
    const lottery = await performGiveawayLottery(id);
    if (lottery.success) {
      await purgePastGiveawaysCache().catch((error) =>
        console.error("Error purging giveaways cache:", error)
      );
    }

    return NextResponse.json({
      success: true,
      message: lottery.success
        ? "Sorteo finalizado y sorteado correctamente"
        : "Sorteo finalizado; el sorteo se hará en la próxima pasada del cron",
      giveaway,
      lottery,
    });
  } catch (error) {
    console.error("Error finishing giveaway:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
