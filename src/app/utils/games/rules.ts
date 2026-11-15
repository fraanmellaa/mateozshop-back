import { getGamesSettings } from "@/app/utils/settings";

import { publicGamesConfig } from "./engine";

/**
 * Reglas públicas de los juegos para las bases legales: RTP, multiplicador
 * máximo, tablas del Plinko de cada nivel, límites de apuesta, tope diario y
 * reglas del torneo. Sin semillas ni nada secreto.
 */
export async function getPublicGamesRules(): Promise<Record<string, unknown>> {
  const settings = await getGamesSettings();
  const config = publicGamesConfig(settings);

  return {
    ...config,
    plinko: {
      ...config.plinko,
      rows: 16,
      // Probabilidad de cada casilla de un Plinko de 16 filas: C(16, k) / 2^16.
      slotProbabilities: Array.from({ length: 17 }, (_, k) => {
        let c = 1;
        for (let i = 1; i <= k; i++) c = (c * (16 - k + i)) / i;
        return c / 2 ** 16;
      }),
    },
    dailyWagerCap: settings.dailyWagerCap,
    fairness:
      "Cada tirada usa una semilla de servidor (de la que se publica su hash antes de jugar), una semilla de cliente elegida por el usuario y un contador. La semilla de servidor se revela al cambiarla.",
    tournament: {
      level: settings.tournament.level,
      spinsPerEntry: settings.tournament.spinsPerEntry,
      chipsPerSpin: settings.tournament.chipsPerSpin,
      table: config.plinko.levels[settings.tournament.level].table,
      rules:
        "Torneo semanal gratuito con fichas que no son puntos. Para entrar hay que haber visto al menos un directo esa semana. Gana quien más fichas acumula; en caso de empate, quien terminó antes sus tiradas. Premios para el top 3.",
    },
  };
}
