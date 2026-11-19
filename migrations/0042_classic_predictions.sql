-- 0042: Predicciones (Classic) (19 nov 2026).
--
-- Predicciones de dos opciones en las que se juegan puntos normales, al
-- estilo de las de Twitch. Van APARTE de las predicciones del directo de la
-- 0038 (voto gratis, un único ganador) y de los Pronósticos (`predictions`).
--
--  · Dos opciones (A y B). Cada usuario elige una y pone puntos; puede añadir
--    más a SU opción mientras la votación esté abierta, pero no cambiar de lado.
--    Los puntos se descuentan al momento (movimiento `prediction_bet`).
--  · El multiplicador no es fijo: depende de lo que haya puesto la gente. Al
--    dar el resultado, el bote entero (A + B) se reparte entre los de la opción
--    ganadora en proporción a lo que puso cada uno:
--        cobro = floor(mis puntos × bote total / bote de la opción ganadora)
--    Nunca se reparte más de lo que se puso (los decimales se pierden). Si
--    nadie eligió la opción ganadora, se devuelve todo.
--  · El resultado lo da SIEMPRE el admin a mano. Anular devuelve a cada uno lo
--    que puso (movimiento `prediction_refund`).
--  · La votación se cierra de tres formas (`lock_mode`):
--        manual  cuando el admin la cierra
--        timer   sola, pasados N segundos (`locks_at`)
--        stream  sola, cuando acaba el directo en el que se abrió
--  · Plantillas (`classic_prediction_templates`): predicciones «de serie» que se
--    abren solas en cada directo (modo `stream`), una vez por día de directo.
--    Las crea `classic_prediction_sync()`, que el servidor llama al detectar el
--    directo y cada vez que alguien consulta las predicciones.
--  · Reinicio mensual: antes de poner los saldos a cero el servidor anula las
--    que sigan sin resultado (`classic_prediction_cancel_all`), y una que se
--    intente resolver en un mes distinto al que se abrió se anula en vez de pagar.
--
-- Aplicar a mano en el SQL editor de Supabase. Es idempotente y no cambia
-- ninguna función ni tabla anterior. Requiere la 0012 (points_move), la 0019
-- (stream_sessions, ad_month) y la 0026 (users.deleted_at).

SET search_path TO public;

-- ───────────────────── tablas ─────────────────────

CREATE TABLE IF NOT EXISTS classic_prediction_templates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  option_a text NOT NULL,
  option_b text NOT NULL,
  min_bet integer NOT NULL DEFAULT 10 CHECK (min_bet >= 1),
  max_bet integer NOT NULL DEFAULT 100000 CHECK (max_bet >= min_bet),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE IF NOT EXISTS classic_predictions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id bigint REFERENCES classic_prediction_templates(id) ON DELETE SET NULL,
  live_day date,                       -- día de directo (modo stream)
  title text NOT NULL,
  option_a text NOT NULL,
  option_b text NOT NULL,
  lock_mode text NOT NULL CHECK (lock_mode IN ('manual', 'timer', 'stream')),
  locks_at integer,                    -- fin de la votación (modo timer)
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'locked', 'resolved', 'cancelled')),
  winner text CHECK (winner IN ('a', 'b')),
  min_bet integer NOT NULL CHECK (min_bet >= 1),
  max_bet integer NOT NULL CHECK (max_bet >= min_bet),
  pool_a bigint NOT NULL DEFAULT 0,    -- puntos puestos a cada opción
  pool_b bigint NOT NULL DEFAULT 0,
  bettors_a integer NOT NULL DEFAULT 0,
  bettors_b integer NOT NULL DEFAULT 0,
  paid_total bigint NOT NULL DEFAULT 0,   -- lo repartido a los ganadores
  refunded boolean NOT NULL DEFAULT false, -- se devolvió todo (anulada o sin ganadores)
  cancel_reason text,
  created_by text,
  closed_by text,
  created_at integer NOT NULL,
  locked_at integer,
  resolved_at integer,
  cancelled_at integer
);

-- Cada plantilla se abre como mucho una vez por día de directo (aunque luego
-- se resuelva o se anule: no vuelve a salir en ese directo).
CREATE UNIQUE INDEX IF NOT EXISTS uq_classic_predictions_template_day
  ON classic_predictions (template_id, live_day) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_classic_predictions_status
  ON classic_predictions (status, id DESC);

CREATE TABLE IF NOT EXISTS classic_prediction_bets (
  prediction_id bigint NOT NULL REFERENCES classic_predictions(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('a', 'b')),
  amount integer NOT NULL CHECK (amount > 0),   -- total puesto (suma de todas sus jugadas)
  payout integer NOT NULL DEFAULT 0,            -- lo cobrado al resolver, o lo devuelto
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'won', 'lost', 'refunded')),
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  PRIMARY KEY (prediction_id, user_id)          -- un lado por persona
);
CREATE INDEX IF NOT EXISTS idx_classic_prediction_bets_user
  ON classic_prediction_bets (user_id, prediction_id DESC);

-- ───────────────────── ayudas ─────────────────────

-- Día del directo en curso (el de la sesión abierta más antigua), o NULL si no hay directo.
CREATE OR REPLACE FUNCTION classic_prediction_live_day() RETURNS date
LANGUAGE sql STABLE
SET search_path FROM CURRENT
AS $$
  SELECT min(day) FROM stream_sessions WHERE ended_at IS NULL
$$;

-- ¿Se puede votar ahora? `p_live_day` es el día del directo en curso (o NULL).
CREATE OR REPLACE FUNCTION classic_prediction_votable(
  p_status text, p_lock_mode text, p_locks_at integer, p_live_day date, p_now integer, p_current_live_day date
) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p_status = 'open' AND CASE p_lock_mode
    WHEN 'manual' THEN true
    WHEN 'timer' THEN p_locks_at IS NOT NULL AND p_now < p_locks_at
    WHEN 'stream' THEN p_live_day IS NOT NULL AND p_current_live_day IS NOT NULL AND p_live_day = p_current_live_day
    ELSE false
  END
$$;

-- Comprueba textos y límites de una predicción o plantilla.
CREATE OR REPLACE FUNCTION classic_prediction_check(
  p_title text, p_option_a text, p_option_b text, p_min_bet integer, p_max_bet integer
) RETURNS void
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF char_length(btrim(COALESCE(p_title, ''))) < 3 OR char_length(btrim(p_title)) > 200
     OR char_length(btrim(COALESCE(p_option_a, ''))) < 1 OR char_length(btrim(p_option_a)) > 40
     OR char_length(btrim(COALESCE(p_option_b, ''))) < 1 OR char_length(btrim(p_option_b)) > 40
     OR lower(btrim(p_option_a)) = lower(btrim(p_option_b))
     OR p_min_bet IS NULL OR p_max_bet IS NULL
     OR p_min_bet < 1 OR p_max_bet < p_min_bet OR p_max_bet > 100000000 THEN
    RAISE EXCEPTION 'INVALID_PREDICTION';
  END IF;
END $$;

-- ───────────────────── plantillas (predicciones de serie) ─────────────────────

-- Crea (p_id NULL) o edita una plantilla. Devuelve su id.
CREATE OR REPLACE FUNCTION classic_prediction_template_save(
  p_id bigint,
  p_title text, p_option_a text, p_option_b text,
  p_min_bet integer, p_max_bet integer,
  p_is_active boolean, p_sort_order integer DEFAULT 0
) RETURNS bigint
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_id bigint;
BEGIN
  PERFORM classic_prediction_check(p_title, p_option_a, p_option_b, p_min_bet, p_max_bet);

  IF p_id IS NULL THEN
    IF (SELECT count(*) FROM classic_prediction_templates) >= 20 THEN
      RAISE EXCEPTION 'TOO_MANY_TEMPLATES';
    END IF;
    INSERT INTO classic_prediction_templates
      (title, option_a, option_b, min_bet, max_bet, is_active, sort_order, created_at, updated_at)
    VALUES
      (btrim(p_title), btrim(p_option_a), btrim(p_option_b), p_min_bet, p_max_bet,
       COALESCE(p_is_active, true), COALESCE(p_sort_order, 0), v_now, v_now)
    RETURNING id INTO v_id;
  ELSE
    UPDATE classic_prediction_templates
       SET title = btrim(p_title), option_a = btrim(p_option_a), option_b = btrim(p_option_b),
           min_bet = p_min_bet, max_bet = p_max_bet,
           is_active = COALESCE(p_is_active, is_active),
           sort_order = COALESCE(p_sort_order, sort_order),
           updated_at = v_now
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'TEMPLATE_NOT_FOUND'; END IF;
  END IF;
  RETURN v_id;
END $$;

-- Abre, si hay directo, las plantillas activas que aún no se han abierto en
-- este día de directo. Barata y repetible: sin directo o sin nada pendiente no
-- hace nada. Devuelve cuántas ha abierto.
CREATE OR REPLACE FUNCTION classic_prediction_sync() RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_day date := classic_prediction_live_day();
  v_count integer := 0;
BEGIN
  IF v_day IS NULL THEN RETURN 0; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM classic_prediction_templates t
     WHERE t.is_active
       AND NOT EXISTS (SELECT 1 FROM classic_predictions p WHERE p.template_id = t.id AND p.live_day = v_day)
  ) THEN
    RETURN 0;
  END IF;

  INSERT INTO classic_predictions
    (template_id, live_day, title, option_a, option_b, lock_mode, min_bet, max_bet, created_by, created_at)
  SELECT t.id, v_day, t.title, t.option_a, t.option_b, 'stream', t.min_bet, t.max_bet, 'auto', v_now
    FROM classic_prediction_templates t
   WHERE t.is_active
   ORDER BY t.sort_order, t.id
  ON CONFLICT (template_id, live_day) WHERE template_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- ───────────────────── abrir a mano ─────────────────────

-- Abre una predicción ahora. `p_lock_mode`: manual | timer (con p_seconds) |
-- stream (solo con el directo encendido: NOT_LIVE).
CREATE OR REPLACE FUNCTION classic_prediction_create(
  p_title text, p_option_a text, p_option_b text,
  p_lock_mode text, p_seconds integer,
  p_min_bet integer, p_max_bet integer,
  p_admin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_day date := NULL;
  v_locks integer := NULL;
  v_id bigint;
BEGIN
  PERFORM classic_prediction_check(p_title, p_option_a, p_option_b, p_min_bet, p_max_bet);

  IF p_lock_mode = 'timer' THEN
    IF p_seconds IS NULL OR p_seconds < 10 OR p_seconds > 86400 THEN
      RAISE EXCEPTION 'INVALID_PREDICTION';
    END IF;
    v_locks := v_now + p_seconds;
  ELSIF p_lock_mode = 'stream' THEN
    v_day := classic_prediction_live_day();
    IF v_day IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NOT_LIVE');
    END IF;
  ELSIF p_lock_mode IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION 'INVALID_PREDICTION';
  END IF;

  IF (SELECT count(*) FROM classic_predictions WHERE status IN ('open', 'locked')) >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TOO_MANY_ACTIVE');
  END IF;

  INSERT INTO classic_predictions
    (live_day, title, option_a, option_b, lock_mode, locks_at, min_bet, max_bet, created_by, created_at)
  VALUES
    (v_day, btrim(p_title), btrim(p_option_a), btrim(p_option_b), p_lock_mode, v_locks,
     p_min_bet, p_max_bet, p_admin, v_now)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

-- ───────────────────── jugar puntos ─────────────────────

-- Pone p_amount puntos a una opción. La primera vez fija el lado; después solo
-- se puede añadir al mismo. `p_request_id` hace la llamada repetible: la misma
-- petición dos veces solo cobra una.
-- Errores: PREDICTION_NOT_FOUND, PREDICTION_CLOSED, INVALID_BET, SIDE_LOCKED,
-- BET_OUT_OF_RANGE (DETAIL = mínimo:máximo que aún puede poner), USER_NOT_FOUND
-- y, de points_move, USER_BANNED e INSUFFICIENT_POINTS.
CREATE OR REPLACE FUNCTION classic_prediction_bet(
  p_user_id integer,
  p_prediction_id bigint,
  p_side text,
  p_amount integer,
  p_request_id text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  p classic_predictions%ROWTYPE;
  b classic_prediction_bets%ROWTYPE;
  v_has_bet boolean;
  v_key text;
  v_min integer;
  v_room integer;
  v_balance integer;
BEGIN
  IF p_side IS NULL OR p_side NOT IN ('a', 'b') OR p_amount IS NULL OR p_amount < 1
     OR p_request_id IS NULL OR char_length(p_request_id) < 8 OR char_length(p_request_id) > 64 THEN
    RAISE EXCEPTION 'INVALID_BET';
  END IF;

  -- Bloquea la predicción: las jugadas van de una en una y el cierre o el
  -- resultado esperan a las que estén en curso.
  SELECT * INTO p FROM classic_predictions WHERE id = p_prediction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PREDICTION_NOT_FOUND'; END IF;

  PERFORM 1 FROM users WHERE id = p_user_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;

  SELECT * INTO b FROM classic_prediction_bets WHERE prediction_id = p.id AND user_id = p_user_id;
  v_has_bet := FOUND;

  v_key := 'cpred:' || p.id || ':' || p_user_id || ':' || p_request_id;
  IF EXISTS (SELECT 1 FROM point_transactions WHERE idempotency_key = v_key) THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true,
      'side', b.side, 'amount', b.amount, 'poolA', p.pool_a, 'poolB', p.pool_b,
      'balance', (SELECT total_points - used_points FROM users WHERE id = p_user_id));
  END IF;

  IF NOT classic_prediction_votable(p.status, p.lock_mode, p.locks_at, p.live_day, v_now,
                                    classic_prediction_live_day()) THEN
    RAISE EXCEPTION 'PREDICTION_CLOSED';
  END IF;

  IF v_has_bet AND b.side <> p_side THEN
    RAISE EXCEPTION 'SIDE_LOCKED';
  END IF;

  -- La primera jugada respeta el mínimo; al añadir vale cualquier cantidad. El
  -- máximo es sobre el total que lleva puesto.
  v_min := CASE WHEN v_has_bet THEN 1 ELSE p.min_bet END;
  v_room := p.max_bet - CASE WHEN v_has_bet THEN b.amount ELSE 0 END;
  IF p_amount < v_min OR p_amount > v_room THEN
    RAISE EXCEPTION 'BET_OUT_OF_RANGE' USING DETAIL = v_min::text || ':' || GREATEST(v_room, 0)::text;
  END IF;

  v_balance := points_move(p_user_id, p_amount, 'debit', 'prediction_bet', 'classic_prediction', p.id::text,
                           v_key, jsonb_build_object('side', p_side));

  IF v_has_bet THEN
    UPDATE classic_prediction_bets
       SET amount = amount + p_amount, updated_at = v_now
     WHERE prediction_id = p.id AND user_id = p_user_id;
  ELSE
    INSERT INTO classic_prediction_bets (prediction_id, user_id, side, amount, created_at, updated_at)
    VALUES (p.id, p_user_id, p_side, p_amount, v_now, v_now);
  END IF;

  UPDATE classic_predictions
     SET pool_a = pool_a + CASE WHEN p_side = 'a' THEN p_amount ELSE 0 END,
         pool_b = pool_b + CASE WHEN p_side = 'b' THEN p_amount ELSE 0 END,
         bettors_a = bettors_a + CASE WHEN p_side = 'a' AND NOT v_has_bet THEN 1 ELSE 0 END,
         bettors_b = bettors_b + CASE WHEN p_side = 'b' AND NOT v_has_bet THEN 1 ELSE 0 END
   WHERE id = p.id
  RETURNING pool_a, pool_b INTO p.pool_a, p.pool_b;

  RETURN jsonb_build_object('ok', true, 'duplicate', false,
    'side', p_side, 'amount', CASE WHEN v_has_bet THEN b.amount ELSE 0 END + p_amount,
    'poolA', p.pool_a, 'poolB', p.pool_b, 'balance', v_balance);
END $$;

-- ───────────────────── cerrar la votación ─────────────────────

CREATE OR REPLACE FUNCTION classic_prediction_lock(p_prediction_id bigint, p_admin text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_status text;
BEGIN
  SELECT status INTO v_status FROM classic_predictions WHERE id = p_prediction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PREDICTION_NOT_FOUND'; END IF;
  IF v_status = 'locked' THEN RETURN jsonb_build_object('ok', true, 'duplicate', true); END IF;
  IF v_status <> 'open' THEN RAISE EXCEPTION 'PREDICTION_FINISHED'; END IF;

  UPDATE classic_predictions SET status = 'locked', locked_at = v_now WHERE id = p_prediction_id;
  RETURN jsonb_build_object('ok', true, 'duplicate', false);
END $$;

-- ───────────────────── anular y devolver ─────────────────────

-- Devuelve a cada uno lo que puso y marca la predicción como anulada. Uso
-- interno: la predicción ya debe estar bloqueada (FOR UPDATE) por quien llama.
CREATE OR REPLACE FUNCTION classic_prediction_refund_all(
  p_prediction_id bigint, p_reason text, p_admin text
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  r record;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT user_id, amount FROM classic_prediction_bets
     WHERE prediction_id = p_prediction_id AND status = 'active'
     ORDER BY user_id
  LOOP
    PERFORM points_move(r.user_id, r.amount, 'refund', 'prediction_refund', 'classic_prediction',
                        p_prediction_id::text, 'cpred:' || p_prediction_id || ':' || r.user_id || ':refund',
                        jsonb_build_object('reason', p_reason));
    UPDATE classic_prediction_bets
       SET status = 'refunded', payout = r.amount, updated_at = v_now
     WHERE prediction_id = p_prediction_id AND user_id = r.user_id;
    v_count := v_count + 1;
  END LOOP;

  UPDATE classic_predictions
     SET status = 'cancelled', refunded = true, cancel_reason = p_reason,
         closed_by = p_admin, cancelled_at = v_now
   WHERE id = p_prediction_id;
  RETURN v_count;
END $$;

-- Anula una predicción sin resultado (abierta o cerrada) y devuelve los puntos.
CREATE OR REPLACE FUNCTION classic_prediction_cancel(
  p_prediction_id bigint, p_admin text DEFAULT NULL, p_reason text DEFAULT 'admin'
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_status text;
  v_count integer;
BEGIN
  SELECT status INTO v_status FROM classic_predictions WHERE id = p_prediction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PREDICTION_NOT_FOUND'; END IF;
  IF v_status = 'cancelled' THEN RETURN jsonb_build_object('ok', true, 'duplicate', true, 'refunded', 0); END IF;
  IF v_status = 'resolved' THEN RAISE EXCEPTION 'PREDICTION_FINISHED'; END IF;

  v_count := classic_prediction_refund_all(p_prediction_id, COALESCE(p_reason, 'admin'), p_admin);
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'refunded', v_count);
END $$;

-- Anula todas las que sigan sin resultado (reinicio mensual). Devuelve cuántas.
CREATE OR REPLACE FUNCTION classic_prediction_cancel_all(p_reason text DEFAULT 'monthly_reset') RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT id FROM classic_predictions WHERE status IN ('open', 'locked') ORDER BY id FOR UPDATE
  LOOP
    PERFORM classic_prediction_refund_all(r.id, p_reason, 'auto');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- ───────────────────── dar el resultado y pagar ─────────────────────

-- El admin dice qué opción ha ganado. Reparte el bote entre los que la
-- eligieron, en proporción a lo que puso cada uno. Vale con la votación abierta
-- (la cierra de paso) o ya cerrada. Repetir la llamada no paga dos veces.
--   · Si nadie eligió la opción ganadora: se devuelve todo (`refunded`).
--   · Si se abrió en un mes y se resuelve en otro (cruzó el reinicio mensual):
--     se anula y se devuelve, en vez de pagar puntos del mes anterior.
CREATE OR REPLACE FUNCTION classic_prediction_resolve(
  p_prediction_id bigint, p_winner text, p_admin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  p classic_predictions%ROWTYPE;
  r record;
  v_total bigint;
  v_win_pool bigint;
  v_payout bigint;
  v_paid bigint := 0;
  v_winners integer := 0;
BEGIN
  IF p_winner IS NULL OR p_winner NOT IN ('a', 'b') THEN
    RAISE EXCEPTION 'INVALID_RESULT';
  END IF;

  SELECT * INTO p FROM classic_predictions WHERE id = p_prediction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PREDICTION_NOT_FOUND'; END IF;
  IF p.status = 'resolved' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'winner', p.winner,
      'paid', p.paid_total, 'refunded', p.refunded);
  END IF;
  IF p.status = 'cancelled' THEN RAISE EXCEPTION 'PREDICTION_FINISHED'; END IF;

  IF ad_month(p.created_at) <> ad_month(v_now) THEN
    PERFORM classic_prediction_refund_all(p.id, 'month_changed', p_admin);
    RETURN jsonb_build_object('ok', true, 'duplicate', false, 'winner', NULL,
      'paid', 0, 'refunded', true, 'cancelled', true);
  END IF;

  v_total := p.pool_a + p.pool_b;
  v_win_pool := CASE WHEN p_winner = 'a' THEN p.pool_a ELSE p.pool_b END;

  IF v_win_pool <= 0 THEN
    -- Nadie eligió la opción ganadora: cada uno recupera lo suyo.
    FOR r IN
      SELECT user_id, amount FROM classic_prediction_bets
       WHERE prediction_id = p.id AND status = 'active' ORDER BY user_id
    LOOP
      PERFORM points_move(r.user_id, r.amount, 'refund', 'prediction_refund', 'classic_prediction',
                          p.id::text, 'cpred:' || p.id || ':' || r.user_id || ':refund',
                          jsonb_build_object('reason', 'no_winners'));
      UPDATE classic_prediction_bets
         SET status = 'refunded', payout = r.amount, updated_at = v_now
       WHERE prediction_id = p.id AND user_id = r.user_id;
    END LOOP;
  ELSE
    FOR r IN
      SELECT user_id, side, amount FROM classic_prediction_bets
       WHERE prediction_id = p.id AND status = 'active' ORDER BY user_id
    LOOP
      IF r.side = p_winner THEN
        -- floor(mis puntos × bote total / bote ganador): como mínimo lo que puso.
        v_payout := div(r.amount::numeric * v_total, v_win_pool::numeric)::bigint;
        IF v_payout > 2147483647 THEN RAISE EXCEPTION 'PAYOUT_TOO_LARGE'; END IF;
        PERFORM points_move(r.user_id, v_payout::integer, 'credit', 'prediction_payout', 'classic_prediction',
                            p.id::text, 'cpred:' || p.id || ':' || r.user_id || ':payout',
                            jsonb_build_object('side', r.side, 'bet', r.amount));
        UPDATE classic_prediction_bets
           SET status = 'won', payout = v_payout::integer, updated_at = v_now
         WHERE prediction_id = p.id AND user_id = r.user_id;
        v_paid := v_paid + v_payout;
        v_winners := v_winners + 1;
      ELSE
        UPDATE classic_prediction_bets
           SET status = 'lost', payout = 0, updated_at = v_now
         WHERE prediction_id = p.id AND user_id = r.user_id;
      END IF;
    END LOOP;
  END IF;

  UPDATE classic_predictions
     SET status = 'resolved', winner = p_winner, paid_total = v_paid,
         refunded = (v_win_pool <= 0), closed_by = p_admin,
         locked_at = COALESCE(locked_at, v_now), resolved_at = v_now
   WHERE id = p.id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'winner', p_winner,
    'paid', v_paid, 'winners', v_winners, 'refunded', v_win_pool <= 0);
END $$;

-- ───────────────────── lecturas ─────────────────────

-- Una predicción en JSON (para las dos lecturas). `votable` y `secondsLeft` ya
-- tienen en cuenta el temporizador y si sigue el directo.
CREATE OR REPLACE FUNCTION classic_prediction_json(p classic_predictions, p_now integer, p_live_day date)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'optionA', p.option_a,
    'optionB', p.option_b,
    'lockMode', p.lock_mode,
    'locksAt', p.locks_at,
    'status', p.status,
    'votable', classic_prediction_votable(p.status, p.lock_mode, p.locks_at, p.live_day, p_now, p_live_day),
    'winner', p.winner,
    'minBet', p.min_bet,
    'maxBet', p.max_bet,
    'poolA', p.pool_a,
    'poolB', p.pool_b,
    'bettorsA', p.bettors_a,
    'bettorsB', p.bettors_b,
    'paidTotal', p.paid_total,
    'refunded', p.refunded,
    'cancelReason', p.cancel_reason,
    'fromTemplate', p.template_id IS NOT NULL,
    'createdAt', p.created_at,
    'resolvedAt', p.resolved_at,
    'cancelledAt', p.cancelled_at
  )
$$;

-- Lo que ve un usuario en la extensión: las predicciones en marcha y las
-- terminadas hace poco (para que vea el resultado), cada una con su jugada.
CREATE OR REPLACE FUNCTION classic_prediction_user_list(
  p_user_id integer, p_finished_window_seconds integer DEFAULT 1800
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_day date := classic_prediction_live_day();
  v_window integer := GREATEST(COALESCE(p_finished_window_seconds, 0), 0);
  v_items jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(item ORDER BY active DESC, id DESC), '[]'::jsonb) INTO v_items
    FROM (
      SELECT p.id,
             p.status IN ('open', 'locked') AS active,
             classic_prediction_json(p, v_now, v_day) || jsonb_build_object(
               'myBet', (SELECT jsonb_build_object('side', b.side, 'amount', b.amount,
                                                   'payout', b.payout, 'status', b.status)
                           FROM classic_prediction_bets b
                          WHERE b.prediction_id = p.id AND b.user_id = p_user_id)
             ) AS item
        FROM classic_predictions p
       WHERE p.status IN ('open', 'locked')
          OR (p.status = 'resolved' AND p.resolved_at >= v_now - v_window)
          OR (p.status = 'cancelled' AND p.cancelled_at >= v_now - v_window
              AND EXISTS (SELECT 1 FROM classic_prediction_bets b
                           WHERE b.prediction_id = p.id AND b.user_id = p_user_id))
       ORDER BY p.id DESC
       LIMIT 30
    ) rows;

  RETURN jsonb_build_object('now', v_now, 'live', v_day IS NOT NULL, 'items', v_items);
END $$;

-- Listado del panel: plantillas y las últimas predicciones.
CREATE OR REPLACE FUNCTION classic_prediction_admin_list(p_limit integer DEFAULT 40) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_day date := classic_prediction_live_day();
BEGIN
  RETURN jsonb_build_object(
    'now', v_now,
    'live', v_day IS NOT NULL,
    'templates', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', t.id, 'title', t.title, 'optionA', t.option_a, 'optionB', t.option_b,
               'minBet', t.min_bet, 'maxBet', t.max_bet, 'isActive', t.is_active, 'sortOrder', t.sort_order
             ) ORDER BY t.sort_order, t.id), '[]'::jsonb)
        FROM classic_prediction_templates t
    ),
    'items', (
      SELECT COALESCE(jsonb_agg(classic_prediction_json(p, v_now, v_day) || jsonb_build_object(
               'createdBy', p.created_by, 'closedBy', p.closed_by, 'lockedAt', p.locked_at
             ) ORDER BY (p.status IN ('open', 'locked')) DESC, p.id DESC), '[]'::jsonb)
        FROM (
          SELECT * FROM classic_predictions
           ORDER BY (status IN ('open', 'locked')) DESC, id DESC
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 40), 1), 100)
        ) p
    )
  );
END $$;

-- ───────────────────── permisos ─────────────────────

-- Solo las ejecuta el servidor (service_role): mueven puntos.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'classic_prediction_live_day()',
    'classic_prediction_votable(text, text, integer, date, integer, date)',
    'classic_prediction_check(text, text, text, integer, integer)',
    'classic_prediction_template_save(bigint, text, text, text, integer, integer, boolean, integer)',
    'classic_prediction_sync()',
    'classic_prediction_create(text, text, text, text, integer, integer, integer, text)',
    'classic_prediction_bet(integer, bigint, text, integer, text)',
    'classic_prediction_lock(bigint, text)',
    'classic_prediction_refund_all(bigint, text, text)',
    'classic_prediction_cancel(bigint, text, text)',
    'classic_prediction_cancel_all(text)',
    'classic_prediction_resolve(bigint, text, text)',
    'classic_prediction_json(classic_predictions, integer, date)',
    'classic_prediction_user_list(integer, integer)',
    'classic_prediction_admin_list(integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_object THEN NULL; -- roles de Supabase ausentes
    END;
  END LOOP;
END $$;

-- Solo el servidor lee y escribe las predicciones, las jugadas y las plantillas.
ALTER TABLE classic_prediction_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE classic_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE classic_prediction_bets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  GRANT ALL ON TABLE classic_prediction_templates TO service_role;
  GRANT ALL ON TABLE classic_predictions TO service_role;
  GRANT ALL ON TABLE classic_prediction_bets TO service_role;
EXCEPTION WHEN undefined_object THEN NULL; -- rol de Supabase ausente
END $$;

NOTIFY pgrst, 'reload schema';
