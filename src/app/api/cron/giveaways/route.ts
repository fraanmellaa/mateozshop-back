import { NextRequest, NextResponse } from "next/server";
import { processFinishedGiveaways } from "@/app/utils/giveaways/lottery";

/**
 * GET /api/cron/giveaways
 * Endpoint para ser ejecutado periódicamente por un cron job externo
 * Revisa y procesa automáticamente los sorteos que han finalizado
 */
export async function GET(request: NextRequest) {
  try {
    // Verificar que la petición viene de un cron job autorizado
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        {
          success: false,
          error: "No autorizado",
        },
        { status: 401 }
      );
    }

    console.log(
      `[CRON] Iniciando revisión de sorteos - ${new Date().toISOString()}`
    );

    const results = await processFinishedGiveaways();

    const successCount = results.filter((r) => r.success).length;
    const errorCount = results.filter((r) => !r.success).length;

    console.log(
      `[CRON] Completado - Exitosos: ${successCount}, Errores: ${errorCount}`
    );

    return NextResponse.json(
      {
        success: true,
        message: `Revisión completada: ${successCount} sorteos exitosos, ${errorCount} errores`,
        timestamp: new Date().toISOString(),
        results,
        summary: {
          total: results.length,
          successful: successCount,
          errors: errorCount,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[CRON] Error durante la revisión de sorteos:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Error interno del servidor",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
