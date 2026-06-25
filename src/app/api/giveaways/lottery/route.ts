import { NextResponse } from "next/server";
import {
  processFinishedGiveaways,
  getGiveawayStats,
} from "@/app/utils/giveaways/lottery";
import { purgePastGiveawaysCache } from "@/app/utils/frontendCache";

/**
 * POST /api/giveaways/lottery
 * Procesa sorteos finalizados automáticamente
 */
export async function POST() {
  try {
    const results = await processFinishedGiveaways();
    const successCount = results.filter((result) => result.success).length;
    const cachePurge = successCount > 0 ? await purgePastGiveawaysCache() : null;

    return NextResponse.json(
      {
        success: true,
        message: `Procesados ${results.length} sorteos`,
        results,
        cachePurge,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error al procesar sorteos:", error);
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

/**
 * GET /api/giveaways/lottery
 * Obtiene estadísticas de sorteos
 */
export async function GET() {
  try {
    const stats = await getGiveawayStats();

    return NextResponse.json(
      {
        success: true,
        stats,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error al obtener estadísticas:", error);
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
