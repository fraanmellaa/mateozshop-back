/**
 * Utilidades para desarrollo y testing del sistema de sorteos
 * Ejecutar con: npx ts-node src/scripts/giveaways-dev.ts
 */

import {
  processFinishedGiveaways,
  performGiveawayLottery,
  getGiveawayStats,
} from "../app/utils/giveaways/lottery";

async function main() {
  const command = process.argv[2];

  try {
    switch (command) {
      case "stats":
        console.log("📊 Obteniendo estadísticas...");
        const stats = await getGiveawayStats();
        console.log(JSON.stringify(stats, null, 2));
        break;

      case "process":
        console.log("🎲 Procesando sorteos finalizados...");
        const results = await processFinishedGiveaways();
        console.log("Resultados:", JSON.stringify(results, null, 2));
        break;

      case "lottery":
        const giveawayId = parseInt(process.argv[3]);
        if (isNaN(giveawayId)) {
          console.error("❌ Debes proporcionar un ID válido de sorteo");
          console.log("Uso: npm run dev:giveaway lottery <id>");
          process.exit(1);
        }
        console.log(`🎯 Realizando sorteo para ID: ${giveawayId}`);
        const result = await performGiveawayLottery(giveawayId);
        console.log("Resultado:", JSON.stringify(result, null, 2));
        break;

      default:
        console.log("🎯 Sistema de Sorteos - Herramientas de Desarrollo");
        console.log("===============================================");
        console.log("");
        console.log("Comandos disponibles:");
        console.log("  stats    - Obtener estadísticas de sorteos");
        console.log("  process  - Procesar todos los sorteos finalizados");
        console.log("  lottery <id> - Realizar sorteo específico");
        console.log("");
        console.log("Ejemplos:");
        console.log("  npx ts-node src/scripts/giveaways-dev.ts stats");
        console.log("  npx ts-node src/scripts/giveaways-dev.ts process");
        console.log("  npx ts-node src/scripts/giveaways-dev.ts lottery 1");
        break;
    }
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
