import { getGamesSettings } from "@/app/utils/settings";

import { publicGamesConfig } from "./engine";

/**
 * Reglas públicas de los juegos para las bases legales: RTP, multiplicador
 * máximo, tablas del Plinko de cada nivel, límites de apuesta y reglas del
 * torneo. No hay tope diario de puntos apostados. Sin semillas ni nada secreto.
 */
export async function getPublicGamesRules(): Promise<Record<string, unknown>> {
  const settings = await getGamesSettings();
  const config = publicGamesConfig(settings);

  return {
    ...config,
    crash: {
      ...config.crash,
      rules:
        "Hay una misma ronda para todos los jugadores: se apuesta antes del despegue y el multiplicador sube desde 1,00x igual para todos. Te retiras cuando quieras y cobras tu apuesta por el multiplicador de ese instante; retirarte solo te afecta a ti, la ronda sigue para los demás. La retirada automática es opcional. Si explota antes de que te retires, pierdes la apuesta. Al llegar al multiplicador máximo se cobra sola.",
    },
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
    mines: {
      ...config.mines,
      rules:
        "Tablero de 25 casillas con el número de minas que elijas (de 1 a 24). La apuesta se cobra al empezar. Cada casilla segura que destapas sube el multiplicador: tras k casillas vale RTP × C(25, k) / C(25 − minas, k), truncado a 2 decimales. Puedes plantarte desde la primera y cobrar tu apuesta por el multiplicador; si destapas una mina, pierdes la apuesta. Al limpiar el tablero o llegar al multiplicador máximo se cobra sola. Una partida sin ninguna casilla destapada se puede cancelar y devuelve la apuesta. Las posiciones de las minas se fijan al empezar con tu semilla de servidor, tu semilla de cliente y el contador, y se enseñan al terminar.",
    },
    fairness:
      "Cada tirada usa una semilla de servidor (de la que se publica su hash antes de jugar), una semilla de cliente elegida por el usuario y un contador. La semilla de servidor se revela al cambiarla. En Crash la ronda es común: cada ronda tiene su propia semilla de servidor, con el hash publicado antes de apostar y la semilla revelada al explotar.",
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
