-- 0038: predicciones del directo.
--
-- El admin abre una predicción durante el directo (pregunta con opciones o con
-- un número), los usuarios votan gratis una sola vez desde la extensión, el
-- admin cierra la votación a mano y después pone el resultado. Gana UNA sola
-- persona: quien acierta o quien más se acerca; si hay empate, quien votó
-- primero. El ganador cobra puntos normales (movimiento `prediction`).
--
-- No tiene nada que ver con la tabla `predictions` (los Pronósticos deportivos).
--
-- Aplicar a mano en el SQL editor de Supabase. Es idempotente: se puede
-- ejecutar más de una vez. No cambia ninguna función ni tabla anterior.

SET search_path TO public;

-- ───────────────────── tablas ─────────────────────

CREATE TABLE IF NOT EXISTS stream_predictions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('options', 'number')),
  options jsonb,                       -- ["Sí", "No"] (kind = options)
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'resolved', 'cancelled')),
  winner_points integer NOT NULL CHECK (winner_points > 0),
  stream_session_id bigint,
  stream_started_at integer NOT NULL,  -- directo en el que se abrió (máximo por directo)
  result_option integer,               -- índice de la opción ganadora (kind = options)
  result_number numeric(14, 2),        -- valor real (kind = number)
  winner_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  winner_vote_id bigint,
  paid_points integer NOT NULL DEFAULT 0,
  created_by text,
  created_at integer NOT NULL,
  closed_at integer,
  resolved_at integer,
  cancelled_at integer
);

CREATE INDEX IF NOT EXISTS idx_stream_predictions_stream
  ON stream_predictions (stream_started_at);
-- Como mucho una predicción en marcha (abierta, o cerrada sin resultado) a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stream_predictions_active
  ON stream_predictions ((true)) WHERE status IN ('open', 'closed');

CREATE TABLE IF NOT EXISTS stream_prediction_votes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- el orden de voto es el de este id
  prediction_id bigint NOT NULL REFERENCES stream_predictions(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_index integer,
  number_value numeric(14, 2),
  created_at integer NOT NULL,
  UNIQUE (prediction_id, user_id)      -- un voto por persona, sin cambios
);

CREATE INDEX IF NOT EXISTS idx_stream_prediction_votes_user
  ON stream_prediction_votes (user_id);

-- ───────────────────── abrir ─────────────────────

-- Abre una predicción. Solo con el directo encendido, con el máximo por directo
-- y sin otra en marcha. Las canceladas no cuentan para el máximo.
CREATE OR REPLACE FUNCTION stream_prediction_create(
  p_question text,
  p_kind text,
  p_options jsonb,
  p_winner_points integer,
  p_max_per_stream integer,
  p_admin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_started integer;
  v_session bigint;
  v_count integer;
  v_question text := btrim(COALESCE(p_question, ''));
  v_options jsonb := NULL;
  v_id bigint;
BEGIN
  IF p_kind NOT IN ('options', 'number')
     OR char_length(v_question) < 3 OR char_length(v_question) > 200
     OR p_winner_points IS NULL OR p_winner_points < 1 OR p_winner_points > 1000000
     OR p_max_per_stream IS NULL OR p_max_per_stream < 0 THEN
    RAISE EXCEPTION 'INVALID_PREDICTION';
  END IF;

  IF p_kind = 'options' THEN
    IF p_options IS NULL OR jsonb_typeof(p_options) <> 'array'
       OR jsonb_array_length(p_options) < 2 OR jsonb_array_length(p_options) > 6 THEN
      RAISE EXCEPTION 'INVALID_PREDICTION';
    END IF;
    SELECT jsonb_agg(btrim(o.value) ORDER BY o.ord) INTO v_options
      FROM jsonb_array_elements_text(p_options) WITH ORDINALITY AS o(value, ord);
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_options) AS o(value)
       WHERE char_length(o.value) < 1 OR char_length(o.value) > 60
    ) OR (
      SELECT count(DISTINCT lower(o.value)) FROM jsonb_array_elements_text(v_options) AS o(value)
    ) <> jsonb_array_length(v_options) THEN
      RAISE EXCEPTION 'INVALID_PREDICTION';
    END IF;
  END IF;

  -- Serializa las altas: el máximo por directo no se puede saltar con dos a la vez.
  PERFORM pg_advisory_xact_lock(7210038);

  SELECT min(started_at), min(id) INTO v_started, v_session
    FROM stream_sessions WHERE ended_at IS NULL;
  IF v_started IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_LIVE');
  END IF;

  IF EXISTS (SELECT 1 FROM stream_predictions WHERE status IN ('open', 'closed')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_ACTIVE');
  END IF;

  SELECT count(*) INTO v_count FROM stream_predictions
   WHERE stream_started_at >= v_started AND status <> 'cancelled';
  IF v_count >= p_max_per_stream THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LIMIT_REACHED');
  END IF;

  INSERT INTO stream_predictions
    (question, kind, options, winner_points, stream_session_id, stream_started_at, created_by, created_at)
  VALUES
    (v_question, p_kind, v_options, p_winner_points, v_session, v_started, p_admin, v_now)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

-- ───────────────────── votar ─────────────────────

-- Un voto por persona y predicción, mientras esté abierta. No se puede cambiar.
-- Gratis: no mueve puntos.
CREATE OR REPLACE FUNCTION stream_prediction_vote(
  p_prediction_id bigint,
  p_user_id integer,
  p_option integer DEFAULT NULL,
  p_number numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_banned boolean;
  v_deleted integer;
  p stream_predictions%ROWTYPE;
  v_id bigint;
BEGIN
  SELECT COALESCE(is_banned, false), deleted_at INTO v_banned, v_deleted
    FROM users WHERE id = p_user_id;
  IF NOT FOUND OR v_deleted IS NOT NULL THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF v_banned THEN RAISE EXCEPTION 'USER_BANNED'; END IF;

  -- FOR SHARE: el cierre (UPDATE) espera a los votos en curso y los votos que
  -- llegan después del cierre ya ven la predicción cerrada.
  SELECT * INTO p FROM stream_predictions WHERE id = p_prediction_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PREDICTION_NOT_FOUND'; END IF;
  IF p.status <> 'open' THEN RAISE EXCEPTION 'PREDICTION_CLOSED'; END IF;

  IF p.kind = 'options' THEN
    IF p_option IS NULL OR p_number IS NOT NULL
       OR p_option < 0 OR p_option >= jsonb_array_length(p.options) THEN
      RAISE EXCEPTION 'INVALID_VOTE';
    END IF;
  ELSE
    IF p_number IS NULL OR p_option IS NOT NULL
       OR p_number < -999999999 OR p_number > 999999999 THEN
      RAISE EXCEPTION 'INVALID_VOTE';
    END IF;
  END IF;

  INSERT INTO stream_prediction_votes (prediction_id, user_id, option_index, number_value, created_at)
  VALUES (p_prediction_id, p_user_id, p_option, round(p_number, 2), v_now)
  ON CONFLICT (prediction_id, user_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'ALREADY_VOTED'; END IF;

  RETURN jsonb_build_object('ok', true, 'voteId', v_id);
END $$;

-- ───────────────────── cerrar la votación ─────────────────────

CREATE OR REPLACE FUNCTION stream_prediction_close(p_prediction_id bigint) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_status text;
BEGIN
  SELECT status INTO v_status FROM stream_predictions WHERE id = p_prediction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PREDICTION_NOT_FOUND'; END IF;
  IF v_status = 'closed' THEN RETURN jsonb_build_object('ok', true, 'duplicate', true); END IF;
  IF v_status <> 'open' THEN RAISE EXCEPTION 'PREDICTION_NOT_OPEN'; END IF;

  UPDATE stream_predictions SET status = 'closed', closed_at = v_now WHERE id = p_prediction_id;
  RETURN jsonb_build_object('ok', true, 'duplicate', false);
END $$;

-- ───────────────────── poner el resultado y pagar ─────────────────────

-- Solo con la votación ya cerrada. Elige UN ganador y le paga:
--   · opciones: el primero que votó la opción correcta (si nadie acertó, no hay ganador);
--   · número: el voto más cercano al valor real; si empatan, el primero que votó.
-- Los baneados y las cuentas borradas no ganan (pasa al siguiente). Repetir la
-- llamada no paga dos veces: devuelve el resultado ya guardado.
CREATE OR REPLACE FUNCTION stream_prediction_resolve(
  p_prediction_id bigint,
  p_option integer DEFAULT NULL,
  p_number numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  p stream_predictions%ROWTYPE;
  v_vote bigint;
  v_winner integer;
  v_paid integer := 0;
BEGIN
  SELECT * INTO p FROM stream_predictions WHERE id = p_prediction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PREDICTION_NOT_FOUND'; END IF;

  IF p.status = 'resolved' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true,
      'winnerUserId', p.winner_user_id, 'points', p.paid_points);
  END IF;
  IF p.status <> 'closed' THEN RAISE EXCEPTION 'PREDICTION_NOT_CLOSED'; END IF;

  IF p.kind = 'options' THEN
    IF p_option IS NULL OR p_number IS NOT NULL
       OR p_option < 0 OR p_option >= jsonb_array_length(p.options) THEN
      RAISE EXCEPTION 'INVALID_RESULT';
    END IF;
    SELECT v.id, v.user_id INTO v_vote, v_winner
      FROM stream_prediction_votes v
      JOIN users u ON u.id = v.user_id
     WHERE v.prediction_id = p.id AND v.option_index = p_option
       AND NOT COALESCE(u.is_banned, false) AND u.deleted_at IS NULL
     ORDER BY v.id
     LIMIT 1;
  ELSE
    IF p_number IS NULL OR p_option IS NOT NULL
       OR p_number < -999999999 OR p_number > 999999999 THEN
      RAISE EXCEPTION 'INVALID_RESULT';
    END IF;
    SELECT v.id, v.user_id INTO v_vote, v_winner
      FROM stream_prediction_votes v
      JOIN users u ON u.id = v.user_id
     WHERE v.prediction_id = p.id AND v.number_value IS NOT NULL
       AND NOT COALESCE(u.is_banned, false) AND u.deleted_at IS NULL
     ORDER BY abs(v.number_value - round(p_number, 2)), v.id
     LIMIT 1;
  END IF;

  IF v_winner IS NOT NULL THEN
    PERFORM points_move(
      v_winner, p.winner_points, 'credit', 'prediction', 'stream_prediction', p.id::text,
      'prediction:' || p.id,
      jsonb_build_object('voteId', v_vote)
    );
    v_paid := p.winner_points;
  END IF;

  UPDATE stream_predictions
     SET status = 'resolved',
         result_option = CASE WHEN p.kind = 'options' THEN p_option END,
         result_number = CASE WHEN p.kind = 'number' THEN round(p_number, 2) END,
         winner_user_id = v_winner,
         winner_vote_id = v_vote,
         paid_points = v_paid,
         resolved_at = v_now
   WHERE id = p.id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false,
    'winnerUserId', v_winner, 'points', v_paid);
END $$;

-- ───────────────────── anular ─────────────────────

-- Anula una predicción sin resultado (abierta o cerrada). No paga a nadie y no
-- cuenta para el máximo por directo.
CREATE OR REPLACE FUNCTION stream_prediction_cancel(p_prediction_id bigint) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_status text;
BEGIN
  SELECT status INTO v_status FROM stream_predictions WHERE id = p_prediction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PREDICTION_NOT_FOUND'; END IF;
  IF v_status = 'cancelled' THEN RETURN jsonb_build_object('ok', true, 'duplicate', true); END IF;
  IF v_status = 'resolved' THEN RAISE EXCEPTION 'PREDICTION_RESOLVED'; END IF;

  UPDATE stream_predictions SET status = 'cancelled', cancelled_at = v_now WHERE id = p_prediction_id;
  RETURN jsonb_build_object('ok', true, 'duplicate', false);
END $$;

-- ───────────────────── lecturas ─────────────────────

-- Lo que enseña la extensión a un usuario: la predicción en marcha (abierta o
-- cerrada sin resultado) o, si no hay, la última resuelta hace poco. NULL si no
-- hay nada que enseñar. Antes del resultado solo se ve el número total de votos.
CREATE OR REPLACE FUNCTION stream_prediction_current(
  p_user_id integer,
  p_resolved_window_seconds integer DEFAULT 1800
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  p stream_predictions%ROWTYPE;
  v_votes integer;
  v_my stream_prediction_votes%ROWTYPE;
  v_winner_name text;
BEGIN
  SELECT * INTO p FROM stream_predictions
   WHERE status IN ('open', 'closed')
      OR (status = 'resolved' AND resolved_at >= v_now - GREATEST(COALESCE(p_resolved_window_seconds, 0), 0))
   ORDER BY (status IN ('open', 'closed')) DESC, id DESC
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_votes FROM stream_prediction_votes WHERE prediction_id = p.id;
  SELECT * INTO v_my FROM stream_prediction_votes WHERE prediction_id = p.id AND user_id = p_user_id;
  IF p.winner_user_id IS NOT NULL THEN
    SELECT username INTO v_winner_name FROM users WHERE id = p.winner_user_id;
  END IF;

  RETURN jsonb_build_object(
    'id', p.id,
    'question', p.question,
    'kind', p.kind,
    'options', COALESCE(p.options, '[]'::jsonb),
    'status', p.status,
    'winnerPoints', p.winner_points,
    'votes', v_votes,
    'myVote', CASE WHEN v_my.id IS NULL THEN NULL
      ELSE jsonb_build_object('option', v_my.option_index, 'number', v_my.number_value) END,
    'result', CASE WHEN p.status <> 'resolved' THEN NULL
      ELSE jsonb_build_object('option', p.result_option, 'number', p.result_number) END,
    'winner', CASE WHEN p.status <> 'resolved' OR p.winner_user_id IS NULL THEN NULL
      ELSE jsonb_build_object('name', COALESCE(v_winner_name, ''), 'isMe', p.winner_user_id = p_user_id) END
  );
END $$;

-- Listado del panel: las últimas predicciones con sus votos (total y por
-- opción) y el ganador.
CREATE OR REPLACE FUNCTION stream_prediction_admin_list(p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path FROM CURRENT
AS $$
  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'id')::bigint DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'id', p.id,
        'question', p.question,
        'kind', p.kind,
        'options', COALESCE(p.options, '[]'::jsonb),
        'status', p.status,
        'winnerPoints', p.winner_points,
        'streamStartedAt', p.stream_started_at,
        'resultOption', p.result_option,
        'resultNumber', p.result_number,
        'paidPoints', p.paid_points,
        'createdAt', p.created_at,
        'closedAt', p.closed_at,
        'resolvedAt', p.resolved_at,
        'votes', (SELECT count(*) FROM stream_prediction_votes v WHERE v.prediction_id = p.id),
        'optionVotes', CASE WHEN p.kind <> 'options' THEN NULL ELSE (
          SELECT jsonb_agg(
                   (SELECT count(*) FROM stream_prediction_votes v
                     WHERE v.prediction_id = p.id AND v.option_index = o.ord - 1)
                   ORDER BY o.ord)
            FROM jsonb_array_elements(p.options) WITH ORDINALITY AS o(value, ord)
        ) END,
        'winner', CASE WHEN p.winner_user_id IS NULL THEN NULL ELSE (
          SELECT jsonb_build_object(
                   'id', u.id, 'username', u.username,
                   'number', (SELECT v.number_value FROM stream_prediction_votes v WHERE v.id = p.winner_vote_id))
            FROM users u WHERE u.id = p.winner_user_id
        ) END
      ) AS item
      FROM (
        SELECT * FROM stream_predictions ORDER BY id DESC
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100)
      ) p
    ) rows
$$;

-- ───────────────────── permisos ─────────────────────

-- Solo las ejecuta el servidor (service_role): mueven puntos o leen votos.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'stream_prediction_create(text, text, jsonb, integer, integer, text)',
    'stream_prediction_vote(bigint, integer, integer, numeric)',
    'stream_prediction_close(bigint)',
    'stream_prediction_resolve(bigint, integer, numeric)',
    'stream_prediction_cancel(bigint)',
    'stream_prediction_current(integer, integer)',
    'stream_prediction_admin_list(integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_object THEN NULL; -- roles de Supabase ausentes
    END;
  END LOOP;
END $$;

-- Solo el servidor lee y escribe las predicciones y los votos.
ALTER TABLE stream_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream_prediction_votes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  GRANT ALL ON TABLE stream_predictions TO service_role;
  GRANT ALL ON TABLE stream_prediction_votes TO service_role;
EXCEPTION WHEN undefined_object THEN NULL; -- rol de Supabase ausente
END $$;

-- Ajustes por defecto (importe del ganador y máximo por directo). Si ya existen, no se tocan.
-- La clave es `stream_predictions`: `predictions` ya la usan los Pronósticos.
INSERT INTO app_settings (key, value, updated_at)
VALUES ('stream_predictions', '{"winnerPoints": 2500, "maxPerStream": 2}'::jsonb, extract(epoch FROM now())::integer)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
