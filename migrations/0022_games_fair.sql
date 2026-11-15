-- 0022: juegos con aleatoriedad verificable (Crash y Plinko), tope diario,
-- registro de cada tirada y torneo semanal (encargo del 14 nov 2026).
--
-- Aplicar a mano en el SQL editor de Supabase DESPUÉS de la 0012 y la 0019.
-- Es idempotente.
--
-- Contiene:
--   · game_rounds ampliada (semillas, nonce, resultado) + índice único que
--     impide reutilizar un nonce
--   · games_wagered_today y games_settle: liquidación ATÓMICA de una petición
--     (tope diario, cobro, pago y una fila por bola/ronda)
--   · torneo semanal: tournaments, tournament_prizes, tournament_entries y sus
--     funciones (crear, unirse, tirar, cerrar, ranking)
--
-- Los resultados se calculan en el back con la semilla reservada por
-- fair_reserve ANTES de llamar a estas funciones. La semilla secreta no se
-- guarda ni se devuelve aquí (solo su hash); la de cada entrada de torneo sí
-- vive en tournament_entries (solo lee el service role) y se revela al terminar.

SET search_path TO public;

-- Los ajustes de la extensión anterior (watch, mines, crash, plinko) ya no se usan.
DELETE FROM app_settings WHERE key = 'extension';

-- ───────────────────── game_rounds: una fila por bola o ronda ─────────────────────

ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS server_seed_hash text;
ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS client_seed text;
ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS nonce bigint;
ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS result jsonb;      -- crash: {point, target, win}; plinko: {risk, path, slot, mult}
ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS request_id text;   -- agrupa las bolas de una misma petición

-- Un nonce no se puede usar dos veces con la misma semilla de servidor (el
-- nonce es único por usuario y semilla, compartido por Crash y Plinko).
CREATE UNIQUE INDEX IF NOT EXISTS uq_game_rounds_nonce
  ON game_rounds (user_id, server_seed_hash, nonce) WHERE nonce IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_game_rounds_request ON game_rounds (request_id) WHERE request_id IS NOT NULL;

-- Apostado hoy (día de Andorra) en Crash + Plinko.
CREATE OR REPLACE FUNCTION games_wagered_today(p_user_id integer) RETURNS integer
LANGUAGE plpgsql STABLE
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_start integer;
  v_total bigint;
BEGIN
  v_start := extract(epoch FROM (ad_day(v_now)::timestamp AT TIME ZONE 'Europe/Andorra'))::integer;
  SELECT COALESCE(SUM(bet), 0) INTO v_total
    FROM game_rounds
   WHERE user_id = p_user_id AND game IN ('crash', 'plinko') AND created_at >= v_start;
  RETURN LEAST(v_total, 2147483647)::integer;
END $$;

-- Liquida una petición de juego de forma atómica. Todo ocurre en una
-- transacción: si algo falla (saldo, tope, nonce repetido) no queda nada.
--   p_rounds: [{ "bet": int, "payout": int, "nonce": bigint, "result": {...} }, ...] (1–100)
-- Bloquea la fila del usuario, así que dos peticiones simultáneas del mismo
-- usuario se serializan y no pueden saltarse el tope diario ni el saldo.
-- DAILY_CAP_REACHED lleva en DETAIL lo que queda hoy.
CREATE OR REPLACE FUNCTION games_settle(
  p_user_id integer,
  p_game text,
  p_request_id text,
  p_daily_cap integer,
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
  v_wagered integer;
  v_balance integer;
  v_ids jsonb;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  IF p_game NOT IN ('crash', 'plinko') THEN
    RAISE EXCEPTION 'INVALID_GAME';
  END IF;
  IF p_request_id IS NULL OR p_server_seed_hash IS NULL OR p_client_seed IS NULL OR p_daily_cap IS NULL THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;
  IF p_rounds IS NULL OR jsonb_typeof(p_rounds) <> 'array' OR jsonb_array_length(p_rounds) < 1
     OR jsonb_array_length(p_rounds) > 100 THEN
    RAISE EXCEPTION 'INVALID_COUNT';
  END IF;

  -- Bloqueo del usuario antes de leer el tope.
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

  v_wagered := games_wagered_today(p_user_id);
  IF v_wagered + v_bet > p_daily_cap THEN
    RAISE EXCEPTION 'DAILY_CAP_REACHED' USING DETAIL = GREATEST(p_daily_cap - v_wagered, 0)::text;
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
    'wagered_today', v_wagered + v_bet,
    'round_ids', v_ids,
    'total_bet', v_bet,
    'total_payout', v_payout
  );
END $$;

-- ───────────────────────── torneo semanal ─────────────────────────

CREATE TABLE IF NOT EXISTS tournaments (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  start_at integer NOT NULL,
  end_at integer NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  level text NOT NULL,                    -- nivel de Plinko
  multipliers jsonb NOT NULL,             -- tabla de 17 casillas fijada al crear el torneo
  chips_per_spin integer NOT NULL CHECK (chips_per_spin > 0),
  spins_per_entry integer NOT NULL CHECK (spins_per_entry > 0),
  created_at integer NOT NULL,
  closed_at integer,
  CONSTRAINT tournaments_dates_valid CHECK (end_at > start_at)
);
CREATE INDEX IF NOT EXISTS idx_tournaments_status_end ON tournaments (status, end_at);

CREATE TABLE IF NOT EXISTS tournament_prizes (
  tournament_id integer NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  place smallint NOT NULL CHECK (place BETWEEN 1 AND 3),
  reward text NOT NULL,                   -- texto libre
  winner_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  winner_chips bigint,
  PRIMARY KEY (tournament_id, place)
);

CREATE TABLE IF NOT EXISTS tournament_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tournament_id integer NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_seed text NOT NULL,              -- SECRETA hasta que la entrada termina o acaba el torneo
  server_seed_hash text NOT NULL,
  client_seed text NOT NULL,
  spins_used integer NOT NULL DEFAULT 0,  -- también es el siguiente nonce
  chips bigint NOT NULL DEFAULT 0,        -- fichas de torneo: NO son puntos
  joined_at integer NOT NULL,
  last_spin_at integer,
  finished_at integer,                    -- cuándo gastó la última tirada
  CONSTRAINT tournament_entries_unique UNIQUE (tournament_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_rank
  ON tournament_entries (tournament_id, chips DESC, finished_at, id);

-- ¿Ha visto el usuario algún directo en los días de Andorra del torneo?
CREATE OR REPLACE FUNCTION tournament_is_eligible(p_user_id integer, p_tournament_id integer) RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path FROM CURRENT
AS $$
DECLARE
  t tournaments%ROWTYPE;
BEGIN
  SELECT * INTO t FROM tournaments WHERE id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM user_watch_days
     WHERE user_id = p_user_id AND minutes > 0
       AND day BETWEEN ad_day(t.start_at) AND ad_day(t.end_at - 1)
  );
END $$;

-- Crea un torneo con sus premios. p_prizes: [{ "place": 1..3, "reward": "texto" }, ...]
CREATE OR REPLACE FUNCTION tournament_create(
  p_title text,
  p_start_at integer,
  p_end_at integer,
  p_level text,
  p_multipliers jsonb,
  p_chips_per_spin integer,
  p_spins_per_entry integer,
  p_prizes jsonb
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_id integer;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  IF p_title IS NULL OR btrim(p_title) = '' OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'INVALID_TOURNAMENT';
  END IF;
  IF p_multipliers IS NULL OR jsonb_typeof(p_multipliers) <> 'array' OR jsonb_array_length(p_multipliers) <> 17 THEN
    RAISE EXCEPTION 'INVALID_TOURNAMENT';
  END IF;
  IF p_prizes IS NULL OR jsonb_typeof(p_prizes) <> 'array' OR jsonb_array_length(p_prizes) < 1 THEN
    RAISE EXCEPTION 'INVALID_TOURNAMENT';
  END IF;

  INSERT INTO tournaments
    (title, start_at, end_at, level, multipliers, chips_per_spin, spins_per_entry, created_at)
  VALUES
    (btrim(p_title), p_start_at, p_end_at, p_level, p_multipliers, p_chips_per_spin, p_spins_per_entry, v_now)
  RETURNING id INTO v_id;

  INSERT INTO tournament_prizes (tournament_id, place, reward)
  SELECT v_id, (pz ->> 'place')::smallint, btrim(pz ->> 'reward')
    FROM jsonb_array_elements(p_prizes) pz;

  RETURN v_id;
END $$;

-- Inscribe al usuario (idempotente: si ya está inscrito devuelve su entrada).
CREATE OR REPLACE FUNCTION tournament_join(p_tournament_id integer, p_user_id integer) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  t tournaments%ROWTYPE;
  e tournament_entries%ROWTYPE;
  v_banned boolean;
  v_adult integer;
  v_seed text;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
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

  SELECT * INTO t FROM tournaments WHERE id = p_tournament_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND';
  END IF;

  SELECT * INTO e FROM tournament_entries WHERE tournament_id = t.id AND user_id = p_user_id;
  IF FOUND THEN
    RETURN jsonb_build_object('entry_id', e.id, 'created', false);
  END IF;

  IF t.status <> 'open' OR v_now < t.start_at OR v_now >= t.end_at THEN
    RAISE EXCEPTION 'TOURNAMENT_NOT_OPEN';
  END IF;
  IF NOT tournament_is_eligible(p_user_id, t.id) THEN
    RAISE EXCEPTION 'NOT_ELIGIBLE';
  END IF;

  v_seed := fair_random_hex();
  INSERT INTO tournament_entries
    (tournament_id, user_id, server_seed, server_seed_hash, client_seed, joined_at)
  VALUES
    (t.id, p_user_id, v_seed, fair_hash(v_seed), substr(fair_random_hex(), 1, 16), v_now)
  ON CONFLICT (tournament_id, user_id) DO NOTHING
  RETURNING * INTO e;

  IF NOT FOUND THEN
    SELECT * INTO e FROM tournament_entries WHERE tournament_id = t.id AND user_id = p_user_id;
    RETURN jsonb_build_object('entry_id', e.id, 'created', false);
  END IF;

  RETURN jsonb_build_object('entry_id', e.id, 'created', true);
END $$;

-- Aplica un lote de tiradas ya calculadas en el back. p_expected_used es el
-- nº de tiradas que el back creía gastadas (= primer nonce usado): si otra
-- petición se adelantó, STALE_ENTRY y no se aplica nada, así que un nonce
-- nunca se usa dos veces. p_chips: [fichas ganadas por bola, ...] (1–100).
CREATE OR REPLACE FUNCTION tournament_spin(
  p_entry_id bigint,
  p_user_id integer,
  p_expected_used integer,
  p_chips jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  e tournament_entries%ROWTYPE;
  t tournaments%ROWTYPE;
  v_banned boolean;
  v_n integer;
  v_sum bigint;
  v_used integer;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  IF p_chips IS NULL OR jsonb_typeof(p_chips) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_COUNT';
  END IF;
  v_n := jsonb_array_length(p_chips);
  IF v_n < 1 OR v_n > 100 THEN
    RAISE EXCEPTION 'INVALID_COUNT';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_chips) c WHERE c::bigint < 0) THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  SELECT * INTO e FROM tournament_entries WHERE id = p_entry_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTRY_NOT_FOUND';
  END IF;

  -- FOR SHARE: se serializa con tournament_close (FOR UPDATE).
  SELECT * INTO t FROM tournaments WHERE id = e.tournament_id FOR SHARE;
  IF t.status <> 'open' OR v_now < t.start_at OR v_now >= t.end_at THEN
    RAISE EXCEPTION 'TOURNAMENT_NOT_OPEN';
  END IF;

  SELECT COALESCE(is_banned, false) INTO v_banned FROM users WHERE id = p_user_id;
  IF v_banned THEN
    RAISE EXCEPTION 'USER_BANNED';
  END IF;

  IF e.spins_used <> p_expected_used THEN
    RAISE EXCEPTION 'STALE_ENTRY';
  END IF;
  IF e.spins_used + v_n > t.spins_per_entry THEN
    RAISE EXCEPTION 'NO_SPINS_LEFT';
  END IF;

  SELECT COALESCE(sum(c::bigint), 0) INTO v_sum FROM jsonb_array_elements_text(p_chips) c;
  v_used := e.spins_used + v_n;

  UPDATE tournament_entries
     SET spins_used = v_used,
         chips = chips + v_sum,
         last_spin_at = v_now,
         finished_at = CASE WHEN v_used >= t.spins_per_entry THEN v_now ELSE finished_at END
   WHERE id = e.id
  RETURNING * INTO e;

  RETURN jsonb_build_object(
    'chips', e.chips,
    'spins_used', e.spins_used,
    'spins_left', t.spins_per_entry - e.spins_used,
    'finished', e.finished_at IS NOT NULL
  );
END $$;

-- Ranking: más fichas; empate: quien terminó antes (finished_at; quien no ha
-- terminado, detrás), luego quien tiró antes por última vez. Sin baneados.
CREATE OR REPLACE FUNCTION tournament_ranking(
  p_tournament_id integer,
  p_limit integer DEFAULT 50,
  p_user_id integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path FROM CURRENT
AS $$
  WITH ranked AS (
    SELECT row_number() OVER (
             ORDER BY e.chips DESC, e.finished_at ASC NULLS LAST, e.last_spin_at ASC NULLS LAST, e.id ASC
           ) AS rn,
           e.user_id, u.username, u.image, e.chips, e.spins_used, e.finished_at
      FROM tournament_entries e
      JOIN users u ON u.id = e.user_id
     WHERE e.tournament_id = p_tournament_id
       AND e.spins_used > 0
       AND NOT COALESCE(u.is_banned, false)
  )
  SELECT jsonb_build_object(
    'ranking', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'position', rn, 'username', username, 'image', image,
               'chips', chips, 'spinsUsed', spins_used, 'finishedAt', finished_at
             ) ORDER BY rn)
        FROM ranked WHERE rn <= GREATEST(p_limit, 1)
    ), '[]'::jsonb),
    'me', (SELECT jsonb_build_object('position', rn, 'chips', chips) FROM ranked WHERE user_id = p_user_id)
  )
$$;

-- Cierra el torneo (idempotente) y fija los ganadores del top 3. Con cierre
-- manual antes de la hora, end_at se adelanta a ahora.
CREATE OR REPLACE FUNCTION tournament_close(p_tournament_id integer) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  t tournaments%ROWTYPE;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  SELECT * INTO t FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND';
  END IF;
  IF t.status = 'closed' THEN
    RETURN jsonb_build_object('already_closed', true);
  END IF;

  UPDATE tournaments
     SET status = 'closed', closed_at = v_now, end_at = LEAST(end_at, GREATEST(v_now, start_at + 1))
   WHERE id = t.id;

  WITH ranked AS (
    SELECT row_number() OVER (
             ORDER BY e.chips DESC, e.finished_at ASC NULLS LAST, e.last_spin_at ASC NULLS LAST, e.id ASC
           ) AS rn,
           e.user_id, e.chips
      FROM tournament_entries e
      JOIN users u ON u.id = e.user_id
     WHERE e.tournament_id = t.id AND e.chips > 0 AND NOT COALESCE(u.is_banned, false)
  )
  UPDATE tournament_prizes pz
     SET winner_user_id = r.user_id, winner_chips = r.chips
    FROM ranked r
   WHERE pz.tournament_id = t.id AND pz.place = r.rn;

  RETURN jsonb_build_object('already_closed', false);
END $$;

-- ───────────────────── permisos ─────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'games_wagered_today(integer)',
    'games_settle(integer, text, text, integer, text, text, jsonb)',
    'tournament_is_eligible(integer, integer)',
    'tournament_create(text, integer, integer, text, jsonb, integer, integer, jsonb)',
    'tournament_join(integer, integer)',
    'tournament_spin(bigint, integer, integer, jsonb)',
    'tournament_ranking(integer, integer, integer)',
    'tournament_close(integer)'
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
  FOREACH t IN ARRAY ARRAY['tournaments', 'tournament_prizes', 'tournament_entries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('GRANT ALL ON TABLE %I TO service_role', t);
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
