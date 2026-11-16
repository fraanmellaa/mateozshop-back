-- 0030: Buscaminas de apuesta (tablero 5×5, RTP fijo, verificable).
--
-- Aplicar a mano en el SQL editor de Supabase DESPUÉS de la 0012, 0019, 0021,
-- 0022 y 0029. Es idempotente.
-- OJO: si alguna vez se vuelve a ejecutar la 0019 o la 0029, hay que volver a
-- ejecutar esta después (aquellas restauran un fair_rotate que no conoce el
-- Buscaminas).
--
-- Contiene:
--   · las funciones de la partida: mines_start, mines_reveal, mines_cashout,
--     mines_cancel, mines_current (y dos auxiliares: mines_round_view y
--     mines_finish)
--   · fair_rotate redefinida: tampoco deja rotar (= revelar la semilla) con una
--     partida de Buscaminas en curso
--
-- Partida: el back reserva el nonce (fair_reserve), calcula con la semilla
-- secreta las posiciones de las minas y la tabla de multiplicadores en
-- céntimos para ese nº de minas y RTP, y llama a mines_start, que cobra la
-- apuesta y guarda la ronda 'active' con todo en game_rounds.state (solo lo
-- lee el service role). Las funciones NUNCA devuelven las posiciones mientras
-- la ronda está activa: al cerrarla pasan a `result` y `state` se vacía.
--
-- game_rounds.state de una partida activa:
--   { "mines": n, "cells": [posiciones de las minas], "revealed": [seguras
--     destapadas, en orden], "table": [céntimos tras 1, 2, … seguras],
--     "max_cents": tope, "rtp": …, "max_mult": … }
-- Estados finales: won (cobró), lost (mina, o cruzó el reinicio mensual),
-- cancelled (cancelada sin destapar nada; apuesta devuelta).

SET search_path TO public;

-- Partidas 'active' del Buscaminas antiguo (gratuito, sin tabla ni nonce): se
-- cierran para que no bloqueen la única partida activa por usuario.
UPDATE game_rounds
   SET status = 'abandoned',
       finished_at = COALESCE(finished_at, extract(epoch FROM now())::integer),
       updated_at = extract(epoch FROM now())::integer
 WHERE game = 'mines' AND status = 'active'
   AND (nonce IS NULL OR NOT (state ? 'table') OR NOT (state ? 'cells') OR NOT (state ? 'revealed'));

-- Una sola ronda activa por usuario y juego (ya venía de la 0012).
CREATE UNIQUE INDEX IF NOT EXISTS uq_game_rounds_one_active
  ON game_rounds (user_id, game) WHERE status = 'active';

-- ───────────────────── vista pública de una partida ─────────────────────

-- Lo que puede ver el jugador. Con la ronda activa: nº de minas, casillas
-- seguras ya destapadas, multiplicador actual y siguiente y la tabla (pública:
-- solo depende del nº de minas y del RTP). Las posiciones de las minas
-- (`cells`) salen únicamente de `result`, es decir, con la ronda ya cerrada.
CREATE OR REPLACE FUNCTION mines_round_view(r game_rounds) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_balance integer;
  v_base jsonb;
  v_k integer;
BEGIN
  SELECT total_points - used_points INTO v_balance FROM users WHERE id = r.user_id;

  v_base := jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'bet', r.bet,
    'nonce', r.nonce,
    'server_seed_hash', r.server_seed_hash,
    'client_seed', r.client_seed,
    'balance', COALESCE(v_balance, 0)
  );

  IF r.status = 'active' THEN
    v_k := jsonb_array_length(r.state -> 'revealed');
    RETURN v_base || jsonb_build_object(
      'mines', r.state -> 'mines',
      'revealed', r.state -> 'revealed',
      'table', r.state -> 'table',
      'cents', CASE WHEN v_k > 0 THEN r.state -> 'table' -> (v_k - 1) ELSE NULL END,
      'next_cents', r.state -> 'table' -> v_k,
      'max_cents', r.state -> 'max_cents'
    );
  END IF;

  RETURN v_base || jsonb_build_object(
    'payout', r.payout,
    'mines', r.result -> 'mines',
    'revealed', r.result -> 'revealed',
    'table', r.result -> 'table',
    'cents', r.result -> 'cents',
    'cells', r.result -> 'cells',
    'hit', r.result -> 'hit',
    'mode', r.result -> 'mode',
    'refund', r.result -> 'refund'
  );
END $$;

-- ───────────────────── cierre de una partida ─────────────────────

-- ÚNICO sitio donde una partida deja de estar activa. Quien llama ya tiene
-- bloqueado al usuario; aquí se bloquea la ronda. Una ronda ya cerrada se
-- devuelve tal cual (reintentos y dobles clics no pagan dos veces).
--   p_mode: 'bust'    → destapó una mina (p_hit): pierde
--           'cashout' → se planta: cobra apuesta × multiplicador actual
--           'max'     → alcanzó el multiplicador máximo: se cobra sola
--           'cleared' → destapó todas las seguras: se cobra sola
--           'cancel'  → sin ninguna destapada: se devuelve la apuesta
-- Si entre el inicio y el cierre hubo reinicio mensual de saldos (o está a
-- medias), no se paga ni se devuelve nada: la apuesta era del mes cerrado.
CREATE OR REPLACE FUNCTION mines_finish(
  p_round_id uuid,
  p_mode text,
  p_hit integer DEFAULT NULL
) RETURNS game_rounds
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r game_rounds%ROWTYPE;
  v_now integer := extract(epoch FROM now())::integer;
  v_k integer;
  v_cents bigint := 0;       -- multiplicador pagado × 100 (0 = no cobra)
  v_payout integer := 0;
  v_refund integer := 0;
  v_void boolean := false;
BEGIN
  SELECT * INTO r FROM game_rounds WHERE id = p_round_id AND game = 'mines' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND';
  END IF;
  IF r.status <> 'active' THEN
    RETURN r;
  END IF;

  v_k := jsonb_array_length(r.state -> 'revealed');
  IF v_k IS NULL THEN
    RAISE EXCEPTION 'INVALID_ROUND';
  END IF;

  IF EXISTS (
    SELECT 1 FROM monthly_resets m WHERE COALESCE(m.balances_reset_at, v_now) >= r.created_at
  ) THEN
    v_void := true;
  END IF;

  IF p_mode = 'bust' THEN
    IF p_hit IS NULL THEN
      RAISE EXCEPTION 'INVALID_REQUEST';
    END IF;
  ELSIF p_mode = 'cancel' THEN
    -- Solo sin información: con una casilla destapada ya no hay devolución.
    IF v_k <> 0 THEN
      RAISE EXCEPTION 'CANNOT_CANCEL';
    END IF;
    IF NOT v_void THEN
      v_refund := r.bet;
    END IF;
  ELSIF p_mode IN ('cashout', 'max', 'cleared') THEN
    IF v_k < 1 THEN
      RAISE EXCEPTION 'NOTHING_TO_CASH_OUT';
    END IF;
    v_cents := (r.state -> 'table' ->> (v_k - 1))::bigint;
    IF v_cents IS NULL OR v_cents < 0 THEN
      RAISE EXCEPTION 'INVALID_ROUND';
    END IF;
    IF NOT v_void THEN
      -- Entero exacto: floor(apuesta × multiplicador).
      v_payout := ((r.bet::bigint * v_cents) / 100)::integer;
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;

  IF v_payout > 0 THEN
    PERFORM points_move(
      r.user_id, v_payout, 'credit', 'mines_payout', 'game_request', r.request_id,
      'game:' || r.request_id || ':payout', jsonb_build_object('rounds', 1)
    );
  END IF;
  IF v_refund > 0 THEN
    PERFORM points_move(
      r.user_id, v_refund, 'refund', 'mines_refund', 'game_request', r.request_id,
      'game:' || r.request_id || ':refund', jsonb_build_object('rounds', 1)
    );
  END IF;

  UPDATE game_rounds
     SET status = CASE
           WHEN p_mode = 'cancel' THEN 'cancelled'
           WHEN v_payout > 0 THEN 'won'
           ELSE 'lost'
         END,
         payout = v_payout,
         -- Las minas pasan a ser públicas y el estado secreto se vacía.
         result = jsonb_build_object(
           'mines', r.state -> 'mines',
           'cells', r.state -> 'cells',
           'revealed', r.state -> 'revealed',
           'table', r.state -> 'table',
           'hit', p_hit,
           'cents', CASE WHEN v_cents > 0 THEN v_cents ELSE NULL END,
           'win', v_payout > 0,
           'mode', CASE WHEN v_void THEN 'void' ELSE p_mode END,
           'refund', v_refund,
           'rtp', r.state -> 'rtp',
           'maxMult', r.state -> 'max_mult'
         ),
         state = '{}'::jsonb,
         version = version + 1,
         updated_at = v_now,
         finished_at = v_now
   WHERE id = r.id
  RETURNING * INTO r;

  RETURN r;
END $$;

-- ───────────────────── empezar ─────────────────────

-- Cobra la apuesta y guarda la partida 'active'. El back ya validó los límites
-- de apuesta y calculó p_cells (posiciones de las minas, con la semilla secreta
-- y p_nonce) y p_table (céntimos tras 1 … 25−p_mines seguras). Aquí, bajo el
-- bloqueo del usuario:
--   · p_request_id repetido → devuelve la partida que ya creó (no cobra otra vez)
--   · una partida en curso → ROUND_ACTIVE (se retoma o se cierra antes)
--   · la semilla de servidor tiene que seguir siendo la de p_server_seed_hash:
--     si se rotó (= se reveló) entre la reserva y esta llamada → SEED_CHANGED
--   · durante el reinicio mensual de saldos no se empieza → GAMES_PAUSED
--   · ningún multiplicador puede superar el justo, C(25,k)/C(25−m,k): aunque
--     el back se equivocara, una tabla que regale puntos → INVALID_TABLE
CREATE OR REPLACE FUNCTION mines_start(
  p_user_id integer,
  p_request_id text,
  p_bet integer,
  p_mines integer,
  p_cells jsonb,
  p_table jsonb,
  p_max_cents bigint,
  p_rtp numeric,
  p_max_mult numeric,
  p_server_seed_hash text,
  p_client_seed text,
  p_nonce bigint
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r game_rounds%ROWTYPE;
  v_banned boolean;
  v_adult integer;
  v_rid text;
  v_seed text;
  v_seed_nonce bigint;
  v_fair numeric := 1;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9_-]{8,64}$'
     OR p_server_seed_hash IS NULL OR p_client_seed IS NULL OR p_nonce IS NULL THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;
  IF p_bet IS NULL OR p_bet <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;
  IF p_mines IS NULL OR p_mines < 1 OR p_mines > 24 THEN
    RAISE EXCEPTION 'INVALID_MINES';
  END IF;
  IF p_max_cents IS NULL OR p_max_cents < 101 OR p_rtp IS NULL OR p_rtp <= 0 OR p_rtp > 1
     OR p_max_mult IS NULL THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;
  -- El mayor premio posible tiene que caber en un integer.
  IF p_bet::bigint * p_max_cents / 100 > 2147483647 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  -- p_cells: exactamente p_mines casillas distintas entre 0 y 24.
  IF p_cells IS NULL OR jsonb_typeof(p_cells) <> 'array' OR jsonb_array_length(p_cells) <> p_mines THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;
  IF (SELECT count(DISTINCT (e #>> '{}')::integer) FROM jsonb_array_elements(p_cells) AS t(e)
       WHERE CASE WHEN jsonb_typeof(e) = 'number' AND (e #>> '{}') ~ '^[0-9]{1,2}$'
                  THEN (e #>> '{}')::integer BETWEEN 0 AND 24 ELSE false END) <> p_mines THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;

  -- p_table: 25 − p_mines enteros entre 0 y el tope, y nunca por encima del
  -- multiplicador justo Π (25−j)/(25−m−j), j = 0 … k−1.
  IF p_table IS NULL OR jsonb_typeof(p_table) <> 'array' OR jsonb_array_length(p_table) <> 25 - p_mines THEN
    RAISE EXCEPTION 'INVALID_TABLE';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_table) AS t(e)
       WHERE CASE WHEN jsonb_typeof(e) = 'number' AND (e #>> '{}') ~ '^[0-9]{1,10}$'
                  THEN (e #>> '{}')::bigint <= p_max_cents ELSE false END) <> 25 - p_mines THEN
    RAISE EXCEPTION 'INVALID_TABLE';
  END IF;
  FOR i IN 1..(25 - p_mines) LOOP
    v_fair := v_fair * (26 - i)::numeric / (26 - i - p_mines)::numeric;
    IF (p_table ->> (i - 1))::numeric > v_fair * 100 THEN
      RAISE EXCEPTION 'INVALID_TABLE';
    END IF;
  END LOOP;

  SELECT COALESCE(is_banned, false), adult_confirmed_at INTO v_banned, v_adult
    FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  -- Reintento de la misma petición: la partida que ya existe, sin cobrar de nuevo.
  v_rid := 'mines:' || p_user_id || ':' || p_request_id;
  SELECT * INTO r FROM game_rounds
   WHERE user_id = p_user_id AND game = 'mines' AND request_id = v_rid
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN mines_round_view(r) || jsonb_build_object('created', false);
  END IF;

  IF v_banned THEN
    RAISE EXCEPTION 'USER_BANNED';
  END IF;
  IF v_adult IS NULL THEN
    RAISE EXCEPTION 'ADULT_REQUIRED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM game_rounds WHERE user_id = p_user_id AND game = 'mines' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'ROUND_ACTIVE';
  END IF;

  IF EXISTS (SELECT 1 FROM monthly_resets WHERE balances_reset_at IS NULL) THEN
    RAISE EXCEPTION 'GAMES_PAUSED';
  END IF;

  -- fair_rotate también bloquea al usuario, así que la semilla no puede
  -- cambiar entre esta comprobación y el alta de la partida.
  SELECT server_seed, nonce INTO v_seed, v_seed_nonce FROM fair_seeds WHERE user_id = p_user_id;
  IF NOT FOUND OR fair_hash(v_seed) <> p_server_seed_hash OR p_nonce < 0 OR p_nonce >= v_seed_nonce THEN
    RAISE EXCEPTION 'SEED_CHANGED';
  END IF;

  -- points_move no cobra dos veces la misma clave: aquí tiene que ser nueva.
  IF EXISTS (SELECT 1 FROM point_transactions WHERE idempotency_key = 'game:' || v_rid || ':bet') THEN
    RAISE EXCEPTION 'DUPLICATE_REQUEST';
  END IF;

  PERFORM points_move(
    p_user_id, p_bet, 'debit', 'mines_bet', 'game_request', v_rid,
    'game:' || v_rid || ':bet', jsonb_build_object('rounds', 1, 'mines', p_mines)
  );

  INSERT INTO game_rounds
    (user_id, game, bet, status, state, payout, version, created_at, updated_at,
     server_seed_hash, client_seed, nonce, request_id)
  VALUES
    (p_user_id, 'mines', p_bet, 'active',
     jsonb_build_object(
       'mines', p_mines, 'cells', p_cells, 'revealed', '[]'::jsonb, 'table', p_table,
       'max_cents', p_max_cents, 'rtp', p_rtp, 'max_mult', p_max_mult
     ),
     0, 0, v_now, v_now,
     p_server_seed_hash, p_client_seed, p_nonce, v_rid)
  RETURNING * INTO r;

  RETURN mines_round_view(r) || jsonb_build_object('created', true);
END $$;

-- ───────────────────── destapar ─────────────────────

-- Destapa una casilla (0–24). Bloquea usuario y ronda, así que dos peticiones
-- a la vez se atienden una detrás de otra. Devuelve la vista más `outcome`:
--   'safe'     → era segura: se añade y sube el multiplicador (si con ella se
--                limpia el tablero o se alcanza el máximo, se cobra sola)
--   'mine'     → era una mina: la partida se cierra en perdida
--   'repeat'   → ya estaba destapada: no cambia nada (doble clic, reintento)
--   'finished' → la partida ya estaba cerrada: se devuelve cómo terminó
CREATE OR REPLACE FUNCTION mines_reveal(
  p_user_id integer,
  p_round_id uuid,
  p_cell integer
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r game_rounds%ROWTYPE;
  v_k integer;
  v_cents bigint;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  IF p_cell IS NULL OR p_cell < 0 OR p_cell > 24 THEN
    RAISE EXCEPTION 'INVALID_CELL';
  END IF;

  -- Mismo orden de bloqueo que el resto: primero el usuario, luego la ronda.
  PERFORM 1 FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  SELECT * INTO r FROM game_rounds
   WHERE id = p_round_id AND user_id = p_user_id AND game = 'mines' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND';
  END IF;
  IF r.status <> 'active' THEN
    RETURN mines_round_view(r) || jsonb_build_object('outcome', 'finished');
  END IF;

  IF (r.state -> 'revealed') @> to_jsonb(p_cell) THEN
    RETURN mines_round_view(r) || jsonb_build_object('outcome', 'repeat');
  END IF;

  IF (r.state -> 'cells') @> to_jsonb(p_cell) THEN
    r := mines_finish(r.id, 'bust', p_cell);
    RETURN mines_round_view(r) || jsonb_build_object('outcome', 'mine');
  END IF;

  UPDATE game_rounds
     SET state = jsonb_set(state, '{revealed}', (state -> 'revealed') || to_jsonb(p_cell)),
         version = version + 1,
         updated_at = v_now
   WHERE id = r.id
  RETURNING * INTO r;

  v_k := jsonb_array_length(r.state -> 'revealed');
  v_cents := (r.state -> 'table' ->> (v_k - 1))::bigint;
  IF v_cents IS NULL THEN
    RAISE EXCEPTION 'INVALID_ROUND';
  END IF;

  IF v_k >= 25 - (r.state ->> 'mines')::integer THEN
    r := mines_finish(r.id, 'cleared');
  ELSIF v_cents >= (r.state ->> 'max_cents')::bigint THEN
    r := mines_finish(r.id, 'max');
  END IF;

  RETURN mines_round_view(r) || jsonb_build_object('outcome', 'safe');
END $$;

-- ───────────────────── plantarse y cancelar ─────────────────────

-- Plantarse: cobra apuesta × multiplicador actual, una sola vez. Con la ronda
-- ya cerrada devuelve cómo terminó (idempotente). Sin ninguna casilla
-- destapada → NOTHING_TO_CASH_OUT.
CREATE OR REPLACE FUNCTION mines_cashout(p_user_id integer, p_round_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r game_rounds%ROWTYPE;
BEGIN
  PERFORM 1 FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  SELECT * INTO r FROM game_rounds
   WHERE id = p_round_id AND user_id = p_user_id AND game = 'mines' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND';
  END IF;
  IF r.status = 'active' THEN
    r := mines_finish(r.id, 'cashout');
  END IF;
  RETURN mines_round_view(r);
END $$;

-- Cancelar: solo sin ninguna casilla destapada (aún no se ha recibido
-- información); devuelve la apuesta. Con alguna destapada → CANNOT_CANCEL.
CREATE OR REPLACE FUNCTION mines_cancel(p_user_id integer, p_round_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r game_rounds%ROWTYPE;
BEGIN
  PERFORM 1 FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  SELECT * INTO r FROM game_rounds
   WHERE id = p_round_id AND user_id = p_user_id AND game = 'mines' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND';
  END IF;
  IF r.status = 'active' THEN
    r := mines_finish(r.id, 'cancel');
  END IF;
  RETURN mines_round_view(r);
END $$;

-- Partida del usuario: la que se pide por id o, sin id, la que tenga en curso
-- (NULL si no hay). Solo lectura; no caduca sola.
CREATE OR REPLACE FUNCTION mines_current(p_user_id integer, p_round_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r game_rounds%ROWTYPE;
BEGIN
  IF p_round_id IS NOT NULL THEN
    SELECT * INTO r FROM game_rounds
     WHERE id = p_round_id AND user_id = p_user_id AND game = 'mines';
  ELSE
    SELECT * INTO r FROM game_rounds
     WHERE user_id = p_user_id AND game = 'mines' AND status = 'active';
  END IF;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN mines_round_view(r);
END $$;

-- ───────────────────── semillas: no rotar con una partida en curso ─────────────────────

-- Igual que la de la 0029 (bloquea al usuario y liquida un Crash ya terminado)
-- y además se niega con una partida de Buscaminas activa. Rotar revela la
-- semilla de servidor, y con ella se podrían calcular las minas.
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

  -- Bloquea al usuario: se serializa con el inicio y los movimientos de la partida.
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

-- ───────────────────── permisos ─────────────────────
-- Solo el service role (el back) ejecuta las funciones. game_rounds ya tiene
-- RLS activado desde la 0012; se repite por si acaso (es idempotente).

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'mines_round_view(game_rounds)',
    'mines_finish(uuid, text, integer)',
    'mines_start(integer, text, integer, integer, jsonb, jsonb, bigint, numeric, numeric, text, text, bigint)',
    'mines_reveal(integer, uuid, integer)',
    'mines_cashout(integer, uuid)',
    'mines_cancel(integer, uuid)',
    'mines_current(integer, uuid)',
    'fair_rotate(integer, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

ALTER TABLE game_rounds ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  GRANT ALL ON TABLE game_rounds TO service_role;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
