-- 0029: Crash COMPARTIDO (una misma ronda para todos los jugadores) y fin del
-- tope diario de puntos apostados (encargos del 16 nov 2026).
--
-- Aplicar a mano en el SQL editor de Supabase DESPUÉS de la 0012, 0019, 0021 y
-- 0022. Es idempotente y se puede ejecutar ENCIMA de la versión anterior de
-- esta misma 0029 (la de la ronda individual): borra sus funciones, devuelve la
-- apuesta de las rondas individuales que siguieran en curso y restaura
-- fair_rotate.
-- OJO: si alguna vez se vuelve a ejecutar la 0019 o la 0022, hay que volver a
-- ejecutar esta después (aquellas restauran fair_rotate sin protección y la
-- games_settle antigua).
--
-- Contiene:
--   · games_settle SIN tope diario (firma nueva, sin p_daily_cap) y solo para
--     Plinko; se borran la firma antigua y games_wagered_today
--   · limpieza de la ronda individual de Crash (funciones y rondas en curso)
--   · fair_rotate que se niega a rotar con un Buscaminas activo (la misma
--     que deja la 0030; Crash ya no usa las semillas por usuario)
--   · Crash compartido: tablas crash_rounds y crash_bets y las funciones
--     crash_tick (avanza el ciclo), crash_bet y crash_cashout
--
-- Ciclo de Crash (sin servidor persistente: avanza cuando algún cliente
-- consulta): apuestas → vuelo, m(t) = e^(growth · t) → explosión → pausa →
-- ronda siguiente. Cada ronda tiene su semilla de servidor: su hash se publica
-- al crearla y la semilla y el punto de explosión son SECRETOS hasta que la
-- ronda queda liquidada (ninguna función los devuelve antes). El punto lo
-- calcula el back (HMAC de la semilla con el id de la ronda) y llega aquí como
-- candidato, que solo se usa si de verdad toca crear la ronda. El reloj que
-- decide es SIEMPRE el de la base de datos.
--
-- Orden de bloqueos (igual en todas las funciones, para que no haya abrazos
-- mortales): bloqueo global del ciclo → fila de la ronda → fila del usuario
-- (por id ascendente cuando son varios) → fila de la apuesta.

SET search_path TO public;

-- ───────────────────── Plinko: liquidación sin tope diario ─────────────────────

-- Se borran POR NOMBRE (con cualquier firma) las funciones que esta migración
-- sustituye o retira: así se puede ejecutar encima de la versión anterior de
-- la 0029 aunque sus firmas o tipos de retorno fueran otros. Todas las que
-- siguen existiendo se vuelven a crear más abajo.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('crash_start', 'crash_current', 'crash_settle', 'crash_round_view',
                         'crash_now_ms', 'games_settle', 'games_wagered_today')
  LOOP
    EXECUTE 'DROP FUNCTION ' || f.sig;
  END LOOP;
END $$;

-- Liquida una petición de Plinko de forma atómica (cobro, pago y una fila por
-- bola). Igual que la de la 0022 pero sin tope diario. Crash ya no pasa por
-- aquí: tiene sus propias funciones (crash_tick / crash_bet / crash_cashout).
--   p_rounds: [{ "bet": int, "payout": int, "nonce": bigint, "result": {...} }, ...] (1–100)
CREATE OR REPLACE FUNCTION games_settle(
  p_user_id integer,
  p_game text,
  p_request_id text,
  p_server_seed_hash text,
  p_client_seed text,
  p_rounds jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_banned boolean;
  v_adult integer;
  v_n integer;
  v_bet integer;
  v_payout integer;
  v_balance integer;
  v_ids jsonb;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  IF p_game IS DISTINCT FROM 'plinko' THEN
    RAISE EXCEPTION 'INVALID_GAME';
  END IF;
  IF p_request_id IS NULL OR p_server_seed_hash IS NULL OR p_client_seed IS NULL THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;
  IF p_rounds IS NULL OR jsonb_typeof(p_rounds) <> 'array' OR jsonb_array_length(p_rounds) < 1
     OR jsonb_array_length(p_rounds) > 100 THEN
    RAISE EXCEPTION 'INVALID_COUNT';
  END IF;

  -- Bloqueo del usuario: sus peticiones se serializan.
  SELECT COALESCE(is_banned, false), adult_confirmed_at INTO v_banned, v_adult
    FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  IF v_banned THEN
    RAISE EXCEPTION 'USER_BANNED';
  END IF;
  IF v_adult IS NULL THEN
    RAISE EXCEPTION 'ADULT_REQUIRED';
  END IF;

  -- Los totales salen de las filas, no de parámetros aparte.
  SELECT count(*), COALESCE(sum((r ->> 'bet')::integer), 0), COALESCE(sum((r ->> 'payout')::integer), 0)
    INTO v_n, v_bet, v_payout
    FROM jsonb_array_elements(p_rounds) r;
  IF v_bet <= 0 OR v_payout < 0 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rounds) r
     WHERE (r ->> 'bet')::integer <= 0 OR (r ->> 'payout')::integer < 0 OR (r ->> 'nonce') IS NULL
  ) THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  v_balance := points_move(
    p_user_id, v_bet, 'debit', p_game || '_bet', 'game_request', p_request_id,
    'game:' || p_request_id || ':bet', jsonb_build_object('rounds', v_n)
  );

  IF v_payout > 0 THEN
    v_balance := points_move(
      p_user_id, v_payout, 'credit', p_game || '_payout', 'game_request', p_request_id,
      'game:' || p_request_id || ':payout', jsonb_build_object('rounds', v_n)
    );
  END IF;

  WITH ins AS (
    INSERT INTO game_rounds
      (user_id, game, bet, status, state, payout, version, created_at, updated_at, finished_at,
       server_seed_hash, client_seed, nonce, result, request_id)
    SELECT p_user_id, p_game, (r ->> 'bet')::integer,
           CASE WHEN (r ->> 'payout')::integer > 0 THEN 'won' ELSE 'lost' END,
           '{}'::jsonb, (r ->> 'payout')::integer, 0, v_now, v_now, v_now,
           p_server_seed_hash, p_client_seed, (r ->> 'nonce')::bigint, r -> 'result', p_request_id
      FROM jsonb_array_elements(p_rounds) r
    RETURNING id, nonce
  )
  SELECT jsonb_agg(id ORDER BY nonce) INTO v_ids FROM ins;

  RETURN jsonb_build_object(
    'balance', v_balance,
    'round_ids', v_ids,
    'total_bet', v_bet,
    'total_payout', v_payout
  );
END $$;


-- ───────────────────── limpieza de la ronda individual de Crash ─────────────────────
-- Solo hace algo si se llegó a aplicar la versión anterior de esta migración.

-- Rondas individuales que seguían en curso: se cierran devolviendo la apuesta
-- (si se cobró y no ha habido reinicio mensual de saldos desde entonces).
DO $$
DECLARE
  g record;
  v_now integer := extract(epoch FROM now())::integer;
  v_refund boolean;
BEGIN
  FOR g IN
    SELECT id, user_id, bet, request_id, created_at FROM game_rounds
     WHERE game = 'crash' AND status = 'active'
     ORDER BY user_id
  LOOP
    v_refund := g.bet > 0 AND g.request_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM point_transactions
         WHERE idempotency_key = 'game:' || g.request_id || ':bet' AND user_id = g.user_id)
      AND NOT EXISTS (
        SELECT 1 FROM monthly_resets m WHERE COALESCE(m.balances_reset_at, v_now) >= g.created_at);

    IF v_refund THEN
      PERFORM points_move(
        g.user_id, g.bet, 'refund', 'crash_refund', 'game_request', g.request_id,
        'game:' || g.request_id || ':refund', jsonb_build_object('reason', 'crash_shared')
      );
    END IF;

    UPDATE game_rounds
       SET status = 'abandoned',
           state = '{}'::jsonb,   -- el punto secreto ya no hace falta
           result = jsonb_build_object('mode', CASE WHEN v_refund THEN 'refund' ELSE 'closed' END),
           finished_at = v_now,
           updated_at = v_now
     WHERE id = g.id;
  END LOOP;
END $$;

-- ───────────────────── fair_rotate: no rotar con Buscaminas activo ─────────────────────
-- Crash ya no usa las semillas por usuario. Rotar revela la semilla de
-- servidor, y con ella se podrían calcular las minas de una partida en curso:
-- por eso bloquea al usuario y se niega si tiene un Buscaminas activo. Es la
-- misma función que deja la 0030, así el orden de (re)ejecución no importa.
-- (La 0019 sí restaura la versión sin esta protección: tras reejecutarla hay
-- que volver a ejecutar esta.)
CREATE OR REPLACE FUNCTION fair_rotate(p_user_id integer, p_client_seed text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  s fair_seeds%ROWTYPE;
  v_now integer := extract(epoch FROM now())::integer;
  v_new_server text := fair_random_hex();
  v_client text;
BEGIN
  IF p_client_seed IS NOT NULL AND p_client_seed !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'INVALID_CLIENT_SEED';
  END IF;

  PERFORM 1 FROM users WHERE id = p_user_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM game_rounds
     WHERE user_id = p_user_id AND game = 'mines' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'ROUND_ACTIVE';
  END IF;

  PERFORM fair_ensure(p_user_id);
  SELECT * INTO s FROM fair_seeds WHERE user_id = p_user_id FOR UPDATE;

  INSERT INTO fair_seed_history (user_id, server_seed, server_seed_hash, client_seed, nonce_end, revealed_at)
  VALUES (p_user_id, s.server_seed, fair_hash(s.server_seed), s.client_seed, s.nonce, v_now);

  v_client := COALESCE(p_client_seed, s.client_seed);

  UPDATE fair_seeds
     SET server_seed = v_new_server, client_seed = v_client, nonce = 0, updated_at = v_now
   WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'revealed', jsonb_build_object(
      'server_seed', s.server_seed,
      'server_seed_hash', fair_hash(s.server_seed),
      'client_seed', s.client_seed,
      'nonce_end', s.nonce
    ),
    'current', jsonb_build_object(
      'server_seed_hash', fair_hash(v_new_server),
      'client_seed', v_client,
      'nonce', 0
    )
  );
END $$;

-- ───────────────────── Crash compartido: tablas ─────────────────────

-- Una fila por ronda global. `server_seed`, `point` y `crash_at_ms` son
-- secretos mientras status = 'open' (las tablas solo las lee el service role).
CREATE TABLE IF NOT EXISTS crash_rounds (
  id bigint PRIMARY KEY,               -- correlativo; lo asigna crash_tick bajo el bloqueo global
  server_seed text NOT NULL,
  server_seed_hash text NOT NULL,      -- público desde que se crea la ronda
  point numeric(12, 2) NOT NULL,       -- punto de explosión
  rtp numeric NOT NULL,
  max_mult numeric NOT NULL,
  growth double precision NOT NULL,    -- k de m(t) = e^(k·t), por segundo
  created_at_ms bigint NOT NULL,
  starts_at_ms bigint NOT NULL,        -- despegue: hasta entonces se apuesta
  crash_at_ms bigint NOT NULL,         -- explosión: starts_at_ms + ceil(ln(point) / growth · 1000)
  pause_ms integer NOT NULL,           -- pausa tras la explosión antes de la ronda siguiente
  status text NOT NULL DEFAULT 'open', -- open | settled
  settled_at_ms bigint,
  CONSTRAINT crash_rounds_status_chk CHECK (status IN ('open', 'settled'))
);

-- Una apuesta por usuario y ronda.
CREATE TABLE IF NOT EXISTS crash_bets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  round_id bigint NOT NULL REFERENCES crash_rounds(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  request_id text NOT NULL,            -- del cliente: repetir la petición no cobra dos veces
  bet integer NOT NULL CHECK (bet > 0),
  auto_cashout numeric(12, 2),         -- objetivo de la retirada automática (NULL = solo manual)
  status text NOT NULL DEFAULT 'active', -- active | won | lost
  mode text,                           -- manual | auto | max | bust | void
  cashout numeric(12, 2),              -- multiplicador al que se retiró
  payout integer NOT NULL DEFAULT 0,
  created_at integer NOT NULL,
  settled_at integer,
  CONSTRAINT crash_bets_round_user_uq UNIQUE (round_id, user_id),
  CONSTRAINT crash_bets_status_chk CHECK (status IN ('active', 'won', 'lost'))
);
CREATE INDEX IF NOT EXISTS idx_crash_bets_round_status ON crash_bets (round_id, status);
CREATE INDEX IF NOT EXISTS idx_crash_bets_user ON crash_bets (user_id, id DESC);

-- ───────────────────── Crash compartido: funciones ─────────────────────

CREATE OR REPLACE FUNCTION crash_now_ms() RETURNS bigint
LANGUAGE sql VOLATILE AS $$
  SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
$$;

-- Apuesta tal como la ve su dueño.
CREATE OR REPLACE FUNCTION crash_bet_json(b crash_bets) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'round_id', b.round_id,
    'bet', b.bet,
    'auto', b.auto_cashout,
    'status', b.status,
    'mode', b.mode,
    'cashout', b.cashout,
    'payout', b.payout
  )
$$;

-- Cierra UNA apuesta: paga (si p_cents > 0) y la marca. ÚNICO sitio donde una
-- apuesta deja de estar 'active'; bloquea usuario y apuesta, así que llamarla
-- dos veces (retirada + liquidación a la vez, reintentos) paga una sola vez.
--   p_cents: multiplicador pagado × 100 (0 = pierde). Quien llama decide.
-- Si entre la apuesta y este momento hubo reinicio mensual de saldos (o está a
-- medias), el premio no se paga: la apuesta era del mes cerrado.
CREATE OR REPLACE FUNCTION crash_bet_finish(p_bet_id bigint, p_cents bigint, p_mode text) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  b crash_bets%ROWTYPE;
  v_user integer;
  v_now integer;
  v_payout integer := 0;
  v_void boolean := false;
BEGIN
  SELECT user_id INTO v_user FROM crash_bets WHERE id = p_bet_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM 1 FROM users WHERE id = v_user FOR UPDATE;
  SELECT * INTO b FROM crash_bets WHERE id = p_bet_id FOR UPDATE;
  IF NOT FOUND OR b.status <> 'active' THEN
    RETURN;
  END IF;

  v_now := (crash_now_ms() / 1000)::integer;
  IF p_cents > 0 AND EXISTS (
    SELECT 1 FROM monthly_resets m WHERE COALESCE(m.balances_reset_at, v_now) >= b.created_at
  ) THEN
    v_void := true;
  END IF;

  IF p_cents > 0 AND NOT v_void THEN
    -- Entero exacto: floor(apuesta × multiplicador).
    v_payout := ((b.bet::bigint * p_cents) / 100)::integer;
  END IF;

  IF v_payout > 0 THEN
    PERFORM points_move(
      b.user_id, v_payout, 'credit', 'crash_payout', 'crash_round', b.round_id::text,
      'crash:' || b.round_id || ':' || b.user_id || ':payout', jsonb_build_object('mode', p_mode)
    );
  END IF;

  UPDATE crash_bets
     SET status = CASE WHEN v_payout > 0 THEN 'won' ELSE 'lost' END,
         mode = CASE WHEN v_void THEN 'void' ELSE p_mode END,
         cashout = CASE WHEN p_cents > 0 THEN round(p_cents::numeric / 100, 2) ELSE NULL END,
         payout = v_payout,
         settled_at = v_now
   WHERE id = b.id;
END $$;

-- Con la ronda en vuelo: paga las retiradas automáticas cuyo objetivo ya se
-- alcanzó en el instante p_now_ms (que quien llama ya comprobó que es anterior
-- a la explosión). La condición `objetivo <= punto` es la regla de siempre; no
-- revela nada porque además se exige que la curva ya haya pasado el objetivo.
CREATE OR REPLACE FUNCTION crash_pay_autos(p_round_id bigint, p_now_ms bigint) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r crash_rounds%ROWTYPE;
  b record;
  v_mult double precision;
BEGIN
  SELECT * INTO r FROM crash_rounds WHERE id = p_round_id;
  IF NOT FOUND OR r.status <> 'open' OR p_now_ms < r.starts_at_ms OR p_now_ms >= r.crash_at_ms THEN
    RETURN;
  END IF;
  v_mult := exp(LEAST(r.growth * (p_now_ms - r.starts_at_ms)::double precision / 1000::double precision, 50::double precision));

  IF NOT EXISTS (
    SELECT 1 FROM crash_bets
     WHERE round_id = r.id AND status = 'active'
       AND auto_cashout IS NOT NULL AND auto_cashout <= r.point AND auto_cashout::double precision <= v_mult
  ) THEN
    RETURN;
  END IF;
  -- Que lo haga una sola transacción a la vez; las demás no esperan.
  IF NOT pg_try_advisory_xact_lock(7029002) THEN
    RETURN;
  END IF;

  FOR b IN
    SELECT id, auto_cashout FROM crash_bets
     WHERE round_id = r.id AND status = 'active'
       AND auto_cashout IS NOT NULL AND auto_cashout <= r.point AND auto_cashout::double precision <= v_mult
     ORDER BY user_id
  LOOP
    PERFORM crash_bet_finish(b.id, round(b.auto_cashout * 100)::bigint, 'auto');
  END LOOP;
END $$;

-- Liquidación final de una ronda que ya explotó. Quien llama tiene el bloqueo
-- global y la fila de la ronda FOR UPDATE. Todas las apuestas que siguen
-- 'active' se cierran de golpe:
--   objetivo = retirada automática, o el multiplicador máximo si no la había
--   objetivo <= punto → gana al objetivo; si no, pierde
-- Después la ronda pasa a 'settled' y su semilla y su punto ya son públicos.
CREATE OR REPLACE FUNCTION crash_settle_round(p_round_id bigint) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r crash_rounds%ROWTYPE;
  b record;
  v_target numeric;
BEGIN
  SELECT * INTO r FROM crash_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'open' OR crash_now_ms() < r.crash_at_ms THEN
    RETURN;
  END IF;

  FOR b IN
    SELECT id, auto_cashout FROM crash_bets
     WHERE round_id = r.id AND status = 'active'
     ORDER BY user_id
  LOOP
    v_target := COALESCE(b.auto_cashout, r.max_mult);
    IF v_target <= r.point THEN
      PERFORM crash_bet_finish(
        b.id, round(v_target * 100)::bigint,
        CASE WHEN b.auto_cashout IS NOT NULL THEN 'auto' ELSE 'max' END
      );
    ELSE
      PERFORM crash_bet_finish(b.id, 0, 'bust');
    END IF;
  END LOOP;

  UPDATE crash_rounds SET status = 'settled', settled_at_ms = crash_now_ms() WHERE id = r.id;
END $$;

-- Vista PÚBLICA del ciclo: la ronda más reciente, sus jugadores y las últimas
-- explosiones. `point`, `server_seed` y `crash_at_ms` de la ronda solo se
-- incluyen con status = 'settled'; el historial solo lleva rondas liquidadas.
-- `user_id` y `auto` de cada jugador son para el back (saber cuál es la
-- apuesta de quien pregunta): el back NO los envía a los demás.
CREATE OR REPLACE FUNCTION crash_view() RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r crash_rounds%ROWTYPE;
  v_found boolean;
  v_now bigint;
  v_round jsonb := NULL;
  v_players jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_total bigint := 0;
  v_history jsonb;
  v_next_id bigint := 1;
  v_next_at bigint := NULL;
BEGIN
  SELECT * INTO r FROM crash_rounds ORDER BY id DESC LIMIT 1;
  v_found := FOUND;
  v_now := crash_now_ms();

  IF v_found THEN
    v_round := jsonb_build_object(
      'id', r.id,
      'phase', CASE WHEN r.status = 'settled' THEN 'crashed'
                    WHEN v_now < r.starts_at_ms THEN 'betting'
                    ELSE 'flying' END,
      'server_seed_hash', r.server_seed_hash,
      'starts_at_ms', r.starts_at_ms,
      'growth', r.growth,
      'rtp', r.rtp,
      'max_mult', r.max_mult
    );
    IF r.status = 'settled' THEN
      v_round := v_round || jsonb_build_object(
        'point', r.point,
        'server_seed', r.server_seed,
        'crash_at_ms', r.crash_at_ms
      );
      v_next_id := r.id + 1;
      v_next_at := r.crash_at_ms + r.pause_ms;
    ELSE
      v_next_id := NULL;
    END IF;

    SELECT count(*)::integer, COALESCE(sum(bet), 0)::bigint INTO v_count, v_total
      FROM crash_bets WHERE round_id = r.id;

    SELECT COALESCE(jsonb_agg(p.j ORDER BY p.bet DESC, p.id), '[]'::jsonb) INTO v_players
      FROM (
        SELECT cb.id, cb.bet, jsonb_build_object(
                 'user_id', cb.user_id,
                 'name', u.username,
                 'bet', cb.bet,
                 'auto', cb.auto_cashout,
                 'status', cb.status,
                 'mode', cb.mode,
                 'cashout', cb.cashout,
                 'payout', cb.payout
               ) AS j
          FROM crash_bets cb
          JOIN users u ON u.id = cb.user_id
         WHERE cb.round_id = r.id
         ORDER BY cb.bet DESC, cb.id
         LIMIT 300
      ) p;
  END IF;

  SELECT COALESCE(jsonb_agg(h.j ORDER BY h.id DESC), '[]'::jsonb) INTO v_history
    FROM (
      SELECT cr.id, jsonb_build_object(
               'id', cr.id,
               'point', cr.point,
               'server_seed', cr.server_seed,
               'server_seed_hash', cr.server_seed_hash,
               'rtp', cr.rtp,
               'max_mult', cr.max_mult
             ) AS j
        FROM crash_rounds cr
       WHERE cr.status = 'settled'
       ORDER BY cr.id DESC
       LIMIT 15
    ) h;

  RETURN jsonb_build_object(
    'now_ms', v_now,
    'round', v_round,
    'players', v_players,
    'players_count', v_count,
    'players_total', v_total,
    'history', v_history,
    -- Id de la ronda que tocaría crear (NULL si la actual sigue viva) y desde cuándo.
    'next_id', v_next_id,
    'next_at_ms', v_next_at
  );
END $$;

-- Avanza el ciclo si toca y devuelve la vista pública. La llama el back en
-- cada consulta (con una caché de ~250 ms), primero SIN candidato; si la
-- respuesta dice que toca crear la ronda `next_id`, el back genera semilla y
-- punto para ese id y vuelve a llamar con el candidato.
--   · ronda viva: paga las automáticas ya alcanzadas y nada más
--   · ronda que ya explotó: la liquida entera (bajo el bloqueo global)
--   · ronda liquidada + pausa cumplida + candidato para el id siguiente: crea
--     la ronda. Si dos instancias llegan a la vez, la segunda encuentra ya la
--     ronda nueva y su candidato se descarta sin usarse.
CREATE OR REPLACE FUNCTION crash_tick(
  p_next_id bigint DEFAULT NULL,
  p_server_seed text DEFAULT NULL,
  p_server_seed_hash text DEFAULT NULL,
  p_point numeric DEFAULT NULL,
  p_rtp numeric DEFAULT NULL,
  p_max_mult numeric DEFAULT NULL,
  p_growth double precision DEFAULT NULL,
  p_bet_ms integer DEFAULT NULL,
  p_pause_ms integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r crash_rounds%ROWTYPE;
  v_found boolean;
  v_now bigint;
BEGIN
  -- Camino rápido, sin bloqueos: la ronda sigue viva, o está liquidada y no toca crear otra.
  SELECT * INTO r FROM crash_rounds ORDER BY id DESC LIMIT 1;
  v_found := FOUND;
  v_now := crash_now_ms();
  IF v_found AND r.status = 'open' AND v_now < r.crash_at_ms THEN
    IF v_now >= r.starts_at_ms THEN
      PERFORM crash_pay_autos(r.id, v_now);
    END IF;
    RETURN crash_view();
  END IF;
  IF v_found AND r.status = 'settled'
     AND (p_next_id IS NULL OR p_next_id <> r.id + 1 OR v_now < r.crash_at_ms + r.pause_ms) THEN
    RETURN crash_view();
  END IF;
  IF NOT v_found AND p_next_id IS NULL THEN
    RETURN crash_view();
  END IF;

  -- Liquidar o crear: de uno en uno.
  PERFORM pg_advisory_xact_lock(7029001);
  SELECT * INTO r FROM crash_rounds ORDER BY id DESC LIMIT 1 FOR UPDATE;
  v_found := FOUND;
  v_now := crash_now_ms();

  IF v_found AND r.status = 'open' THEN
    IF v_now >= r.crash_at_ms THEN
      PERFORM crash_settle_round(r.id);
    END IF;
    RETURN crash_view();
  END IF;

  IF p_next_id IS NULL
     OR p_next_id <> COALESCE(r.id, 0) + 1
     OR (v_found AND v_now < r.crash_at_ms + r.pause_ms) THEN
    RETURN crash_view();
  END IF;

  IF p_server_seed IS NULL OR p_server_seed !~ '^[0-9a-f]{64}$'
     OR p_server_seed_hash IS NULL OR fair_hash(p_server_seed) <> p_server_seed_hash
     OR p_rtp IS NULL OR p_rtp <= 0 OR p_rtp >= 1
     OR p_max_mult IS NULL OR p_max_mult < 1.01
     OR p_point IS NULL OR p_point < 1 OR p_point > p_max_mult OR p_point <> round(p_point, 2)
     OR p_growth IS NULL OR p_growth <= 0 OR p_growth > 5
     OR p_bet_ms IS NULL OR p_bet_ms < 1000 OR p_bet_ms > 120000
     OR p_pause_ms IS NULL OR p_pause_ms < 0 OR p_pause_ms > 120000 THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;

  INSERT INTO crash_rounds
    (id, server_seed, server_seed_hash, point, rtp, max_mult, growth,
     created_at_ms, starts_at_ms, crash_at_ms, pause_ms, status)
  VALUES
    (p_next_id, p_server_seed, p_server_seed_hash, p_point, p_rtp, p_max_mult, p_growth,
     v_now, v_now + p_bet_ms,
     v_now + p_bet_ms + ceil(ln(p_point::double precision) / p_growth * 1000::double precision)::bigint,
     p_pause_ms, 'open');

  RETURN crash_view();
END $$;

-- Apuesta en la ronda p_round_id, solo mientras está en fase de apuestas. El
-- back ya validó los límites de la apuesta. Aquí, con la ronda bloqueada en
-- modo compartido (la liquidación espera) y el usuario bloqueado:
--   · misma petición repetida (mismo p_request_id) → devuelve la apuesta que
--     ya existe, sin cobrar otra vez
--   · otra apuesta del mismo usuario en la ronda (dos pestañas) → BET_EXISTS
--   · el reloj se lee DESPUÉS de los bloqueos: si la ronda ya despegó → BETS_CLOSED
--   · durante el reinicio mensual de saldos no se apuesta → GAMES_PAUSED
CREATE OR REPLACE FUNCTION crash_bet(
  p_user_id integer,
  p_round_id bigint,
  p_request_id text,
  p_bet integer,
  p_auto numeric
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r crash_rounds%ROWTYPE;
  b crash_bets%ROWTYPE;
  v_banned boolean;
  v_adult integer;
  v_now_ms bigint;
  v_balance integer;
  v_key text;
BEGIN
  IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9_-]{8,64}$' OR p_round_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;
  IF p_bet IS NULL OR p_bet <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;
  IF p_auto IS NOT NULL AND (p_auto < 1.01 OR p_auto <> round(p_auto, 2)) THEN
    RAISE EXCEPTION 'INVALID_TARGET';
  END IF;

  SELECT * INTO r FROM crash_rounds WHERE id = p_round_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND';
  END IF;

  SELECT COALESCE(is_banned, false), adult_confirmed_at, total_points - used_points
    INTO v_banned, v_adult, v_balance
    FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  SELECT * INTO b FROM crash_bets WHERE round_id = p_round_id AND user_id = p_user_id;
  IF FOUND THEN
    IF b.request_id = p_request_id THEN
      RETURN jsonb_build_object('bet', crash_bet_json(b), 'balance', v_balance, 'created', false);
    END IF;
    RAISE EXCEPTION 'BET_EXISTS';
  END IF;

  IF v_banned THEN
    RAISE EXCEPTION 'USER_BANNED';
  END IF;
  IF v_adult IS NULL THEN
    RAISE EXCEPTION 'ADULT_REQUIRED';
  END IF;
  IF p_auto IS NOT NULL AND p_auto > r.max_mult THEN
    RAISE EXCEPTION 'INVALID_TARGET';
  END IF;
  -- El mayor premio posible tiene que caber en un integer: si no, la
  -- liquidación fallaría y dejaría la ronda (y el ciclo entero) atascada.
  IF p_bet::bigint * round(r.max_mult * 100)::bigint / 100 > 2147483647 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;
  IF EXISTS (SELECT 1 FROM monthly_resets WHERE balances_reset_at IS NULL) THEN
    RAISE EXCEPTION 'GAMES_PAUSED';
  END IF;

  v_now_ms := crash_now_ms();
  IF r.status <> 'open' OR v_now_ms >= r.starts_at_ms THEN
    RAISE EXCEPTION 'BETS_CLOSED';
  END IF;

  -- points_move no cobra dos veces la misma clave: aquí tiene que ser nueva.
  v_key := 'crash:' || p_round_id || ':' || p_user_id || ':bet';
  IF EXISTS (SELECT 1 FROM point_transactions WHERE idempotency_key = v_key) THEN
    RAISE EXCEPTION 'DUPLICATE_REQUEST';
  END IF;

  v_balance := points_move(
    p_user_id, p_bet, 'debit', 'crash_bet', 'crash_round', p_round_id::text,
    v_key, jsonb_build_object('auto', p_auto)
  );

  INSERT INTO crash_bets (round_id, user_id, request_id, bet, auto_cashout, status, created_at)
  VALUES (p_round_id, p_user_id, p_request_id, p_bet, p_auto, 'active', (v_now_ms / 1000)::integer)
  RETURNING * INTO b;

  RETURN jsonb_build_object('bet', crash_bet_json(b), 'balance', v_balance, 'created', true);
END $$;

-- Retirada manual de la apuesta del usuario en la ronda p_round_id. Solo le
-- afecta a él: la ronda sigue para los demás. Con la ronda bloqueada en modo
-- compartido y usuario y apuesta bloqueados, y el reloj leído DESPUÉS:
--   · apuesta ya cerrada (doble clic, dos pestañas, ya liquidada) → se
--     devuelve tal cual, sin pagar otra vez
--   · la ronda aún no ha despegado → ROUND_NOT_STARTED (la apuesta no se anula)
--   · la ronda ya explotó (o ya está liquidada) → misma regla que la
--     liquidación final: gana solo si tenía automática con objetivo <= punto
--   · en vuelo: si la automática ya se había alcanzado paga al objetivo; si
--     no, al multiplicador de este instante truncado a 2 decimales (< punto)
-- Nunca devuelve el punto de explosión.
CREATE OR REPLACE FUNCTION crash_cashout(p_user_id integer, p_round_id bigint) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r crash_rounds%ROWTYPE;
  b crash_bets%ROWTYPE;
  v_now_ms bigint;
  v_mult double precision;
  v_target numeric;
  v_cents bigint := 0;
  v_mode text := 'bust';
  v_balance integer;
BEGIN
  SELECT * INTO r FROM crash_rounds WHERE id = p_round_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND';
  END IF;

  PERFORM 1 FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  SELECT * INTO b FROM crash_bets WHERE round_id = p_round_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BET_NOT_FOUND';
  END IF;

  IF b.status = 'active' THEN
    v_now_ms := crash_now_ms();
    IF r.status <> 'open' OR v_now_ms >= r.crash_at_ms THEN
      v_target := COALESCE(b.auto_cashout, r.max_mult);
      IF v_target <= r.point THEN
        v_cents := round(v_target * 100)::bigint;
        v_mode := CASE WHEN b.auto_cashout IS NOT NULL THEN 'auto' ELSE 'max' END;
      END IF;
    ELSIF v_now_ms < r.starts_at_ms THEN
      RAISE EXCEPTION 'ROUND_NOT_STARTED';
    ELSE
      -- Exponente acotado: e^50 supera cualquier multiplicador máximo y no desborda.
      v_mult := exp(LEAST(r.growth * (v_now_ms - r.starts_at_ms)::double precision / 1000::double precision, 50::double precision));
      IF b.auto_cashout IS NOT NULL AND b.auto_cashout <= r.point AND b.auto_cashout::double precision <= v_mult THEN
        v_cents := round(b.auto_cashout * 100)::bigint;
        v_mode := 'auto';
      ELSE
        -- Antes de crash_at_ms el multiplicador es < punto; el LEAST es solo un seguro.
        v_cents := LEAST(floor(v_mult * 100)::bigint, round(r.point * 100)::bigint);
        v_mode := 'manual';
      END IF;
    END IF;

    PERFORM crash_bet_finish(b.id, v_cents, v_mode);
    SELECT * INTO b FROM crash_bets WHERE id = b.id;
  END IF;

  SELECT total_points - used_points INTO v_balance FROM users WHERE id = p_user_id;
  RETURN jsonb_build_object('bet', crash_bet_json(b), 'balance', COALESCE(v_balance, 0));
END $$;

-- ───────────────────── permisos ─────────────────────
-- Solo el service role (el back) ejecuta las funciones y lee las tablas (RLS
-- activado y sin políticas: anon y authenticated no ven nada).

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'games_settle(integer, text, text, text, text, jsonb)',
    'fair_rotate(integer, text)',
    'crash_now_ms()',
    'crash_bet_json(crash_bets)',
    'crash_bet_finish(bigint, bigint, text)',
    'crash_pay_autos(bigint, bigint)',
    'crash_settle_round(bigint)',
    'crash_view()',
    'crash_tick(bigint, text, text, numeric, numeric, numeric, double precision, integer, integer)',
    'crash_bet(integer, bigint, text, integer, numeric)',
    'crash_cashout(integer, bigint)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['game_rounds', 'crash_rounds', 'crash_bets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      IF t <> 'game_rounds' THEN
        EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated', t);
      END IF;
      EXECUTE format('GRANT ALL ON TABLE %I TO service_role', t);
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
