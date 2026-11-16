import { Nonce, intBelow } from "../fair/rng";

import { MINES_CELLS, isValidMines } from "./minesTable";

export * from "./minesTable";

/**
 * BUSCAMINAS de apuesta con RTP fijo. Tablero 5×5 (casillas 0–24, por filas).
 * El jugador elige apuesta y nº de minas; se cobra la apuesta al empezar, cada
 * casilla segura sube el multiplicador (`minesTable.ts`) y puede plantarse
 * desde la primera. Si destapa una mina pierde la apuesta.
 *
 * Dónde vive cada cosa: el back reserva el nonce, calcula aquí las posiciones
 * y la tabla de multiplicadores y las guarda con `mines_start` en
 * `game_rounds.state` (solo lo lee el service role). Destapar, plantarse y
 * cancelar son funciones SQL atómicas (migración 0030) que bloquean usuario y
 * ronda; las minas solo pasan a `result` (público) al cerrar la partida.
 *
 * POR QUÉ NINGUNA SECUENCIA DE LLAMADAS SUPERA EL RTP
 * 1. Lo único que el jugador sabe durante la partida es qué casillas suyas
 *    eran seguras. Las posiciones no salen en ninguna respuesta, error ni
 *    historial con la ronda activa (las vistas SQL leen `state` solo para
 *    contar; `minesPublic` copia `cells` solo si la ronda ya terminó), y la
 *    semilla no se puede revelar: `fair_rotate` se niega con `ROUND_ACTIVE`.
 * 2. Con el reparto uniforme, P(k seguras seguidas) = C(25−m,k)/C(25,k) elija
 *    las casillas que elija, y mult(k) ≤ RTP / P(k) (truncado hacia abajo).
 *    Cualquier estrategia de parada cobra, como mucho, Σ P(k)·π(k)·mult(k) ≤
 *    RTP·Σ π(k) ≤ RTP, siendo π(k) la probabilidad de plantarse en k si llega.
 *    El tope de multiplicador, el truncado y el floor del pago solo lo bajan.
 * 3. Repetir peticiones: `start` es idempotente por `requestId` (no cobra ni
 *    reparte otra vez); destapar una casilla ya destapada devuelve el estado
 *    sin cambiarlo (no sube el multiplicador); plantarse dos veces paga una
 *    (la ronda ya no está activa y `points_move` lleva clave de idempotencia).
 * 4. Dos pestañas o peticiones a la vez: todo se serializa con el bloqueo del
 *    usuario y de la ronda. Plantarse y destapar a la vez → gana la primera
 *    que llega; si fue plantarse, el destape encuentra la ronda cerrada y no
 *    hace nada; si fue el destape y era mina, no hay nada que cobrar.
 * 5. Una sola partida activa por usuario (índice único): no se pueden abrir
 *    varias para quedarse con la mejor. La apuesta ya está cobrada y solo se
 *    devuelve al cancelar SIN ninguna casilla destapada, es decir, sin haber
 *    recibido información; con alguna destapada solo cabe seguir o plantarse.
 *    El nonce de una partida cancelada queda gastado: la siguiente tiene otro
 *    reparto.
 * 6. Semillas: la de cliente y el nonce son los de la reserva y quedan fijados
 *    en la ronda; cambiar la semilla de cliente a media partida solo afecta a
 *    las siguientes. Si la de servidor se rotó (= reveló) entre la reserva y
 *    el alta, `mines_start` rechaza con `SEED_CHANGED` antes de cobrar.
 * 7. La tabla y el RTP se fijan al empezar: cambiar los ajustes a media
 *    partida no la altera. `mines_start` comprueba además que ningún
 *    multiplicador supere el justo (RTP ≤ 1) aunque el back se equivocara.
 * 8. Reinicio mensual: no se empieza con un reinicio a medias y una partida
 *    que lo cruza no paga ni devuelve nada (su apuesta era del mes cerrado).
 */

/**
 * Posiciones de las minas (ordenadas). Fisher–Yates parcial sobre las 25
 * casillas: el paso i saca un entero uniforme en [i, 25) con el cursor i del
 * generador verificable. Todas las combinaciones son igual de probables.
 */
export function minePositions(
  serverSeed: string,
  clientSeed: string,
  nonce: Nonce,
  mines: number
): number[] {
  if (!isValidMines(mines)) throw new Error("Número de minas no válido");
  const cells = Array.from({ length: MINES_CELLS }, (_, i) => i);
  for (let i = 0; i < mines; i++) {
    const j = i + intBelow(MINES_CELLS - i, serverSeed, clientSeed, nonce, i);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, mines).sort((a, b) => a - b);
}
