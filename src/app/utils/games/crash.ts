import { uniformAt } from "../fair/rng";

/**
 * CRASH con RTP fijo. El punto de explosión es un port de
 * `juegos-referencia/crash.js` y NO ha cambiado con la ronda compartida.
 *
 * punto = rtp / (1 − u), u uniforme en [0, 1): la probabilidad de llegar al
 * menos a x es rtp / x. El punto se redondea hacia abajo a 2 decimales y por
 * debajo de 1.00 explota al instante; ambos detalles solo favorecen a la casa.
 *
 * RONDA COMPARTIDA (migración 0029, `crashRound.ts`). Hay UNA ronda para todos
 * los jugadores: fase de apuestas → vuelo, m(t) = e^(k·t) → explosión → pausa
 * → ronda siguiente. No hay servidor persistente: el ciclo avanza cuando algún
 * cliente consulta (`crash_tick`), bajo un bloqueo global. Cada jugador apuesta
 * antes del despegue y se retira cuando quiere (o con retirada automática);
 * retirarse solo le afecta a él y la ronda sigue para el resto.
 *
 * ALEATORIEDAD VERIFICABLE. Cada ronda tiene su semilla de servidor aleatoria;
 * su hash se publica al crear la ronda y la semilla se revela cuando la ronda
 * queda liquidada. u = HMAC-SHA256(semilla, "crash:<id de ronda>:0"), es
 * decir, `crashPoint(semilla, CRASH_PUBLIC_SEED, idRonda, cfg)`. Las semillas
 * por usuario (`fair_*`) ya no intervienen en Crash.
 *
 * POR QUÉ NINGUNA SECUENCIA DE LLAMADAS SUPERA EL RTP
 * 1. Antes de que la ronda quede liquidada, lo único que sale del servidor es
 *    su hash, la hora de despegue y «sigue volando». `point`, `server_seed` y
 *    `crash_at_ms` solo aparecen con la ronda en estado 'settled'
 *    (`crash_view`), el historial solo lleva rondas liquidadas, la retirada
 *    nunca devuelve el punto y los errores de la BD desconocidos se
 *    convierten en un 500 genérico. Sondear mucho no da más información.
 * 2. Ver a los demás tampoco: mientras vuela solo se ve quién sigue dentro y
 *    quién se retiró ya (a un multiplicador que la curva ya pasó). Los
 *    objetivos automáticos ajenos no se envían. Nada de eso depende del punto
 *    más allá de «aún no ha explotado».
 * 3. Con P(punto ≥ x) = rtp / x, sabiendo que la ronda sigue viva en m, la
 *    probabilidad de que llegue a x es m / x: esperar de m a x multiplica el
 *    premio por x / m y la probabilidad por m / x. El valor esperado no cambia
 *    en ningún momento, así que toda estrategia de parada (objetivo fijo,
 *    tiempo aleatorio, automática + manual, decidir según lo visto o según lo
 *    que hagan otros) vale como mucho rtp × apuesta. El truncado a 2
 *    decimales, la explosión en 1.00 y exigir multiplicador < punto en la
 *    manual solo pueden bajarlo.
 * 4. La apuesta solo entra si el reloj de la BD, leído con la ronda y el
 *    usuario bloqueados, es anterior a `starts_at_ms`; antes de ese instante
 *    no ha salido ninguna información del punto (una explosión instantánea
 *    ocurre justo en `starts_at_ms`). Apostar «al filo» o es anterior a toda
 *    información o se rechaza (BETS_CLOSED). La apuesta no se puede anular.
 * 5. La latencia va contra el jugador: en la retirada cuenta el instante en
 *    que la petición llega a la BD (reloj leído bajo bloqueo), nunca el que
 *    diga el cliente; retirar tarde es retirar más arriba o encontrarla ya
 *    explotada.
 * 6. La retirada bloquea la ronda en modo compartido y la liquidación final en
 *    exclusivo, y el punto solo se publica tras esa liquidación: una vez
 *    revelado, ninguna retirada puede ya pagarse por reloj (ve la ronda
 *    'settled' y aplica la regla final).
 * 7. Cada apuesta se cierra una sola vez (`crash_bet_finish`, bloqueo de
 *    usuario y apuesta, clave de idempotencia en `points_move`): doble clic,
 *    dos pestañas, retirada y liquidación a la vez o reintentos pagan una vez.
 *    Hay una apuesta por usuario y ronda (índice único) y el `requestId` hace
 *    idempotente el cobro.
 * 8. Una apuesta abandonada se liquida con la ronda la próxima vez que
 *    cualquiera consulte: gana al objetivo si tenía automática y objetivo ≤
 *    punto (lo mismo que habría cobrado en vivo); si no, pierde. Sin automática
 *    solo gana si la ronda llegó al multiplicador máximo.
 * 9. Reinicio mensual: no se admiten apuestas con un reinicio a medias
 *    (GAMES_PAUSED) y una apuesta anterior a un reinicio de saldos no se paga
 *    (modo 'void'): sus puntos eran del mes cerrado.
 */

export type CrashConfig = { rtp: number; maxMult: number };

/** k de m(t) = e^(k·t), por segundo: 2,00x a los ~6,6 s y 10x a los ~22 s. Se guarda en cada ronda. */
export const CRASH_GROWTH_PER_SEC = 0.105;

/** Duración de la fase de apuestas y pausa tras la explosión (se guardan en cada ronda). */
export const CRASH_BET_MS = 7000;
export const CRASH_PAUSE_MS = 3000;

/** Dato público que acompaña a la semilla de la ronda (hace de «semilla de cliente»). */
export const CRASH_PUBLIC_SEED = "crash";

export function crashPoint(
  serverSeed: string,
  clientSeed: string,
  nonce: number | bigint | string,
  cfg: CrashConfig
): number {
  const u = uniformAt(serverSeed, clientSeed, nonce, 0);
  let p = cfg.rtp / (1 - u);
  p = Math.floor(p * 100) / 100;
  if (p < 1) p = 1.0;
  if (p > cfg.maxMult) p = cfg.maxMult;
  return p;
}

/** Punto de explosión de la ronda global `roundId` con su semilla de servidor. */
export function crashRoundPoint(serverSeed: string, roundId: number, cfg: CrashConfig): number {
  return crashPoint(serverSeed, CRASH_PUBLIC_SEED, roundId, cfg);
}
