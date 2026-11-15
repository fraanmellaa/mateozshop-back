-- 0021: motor de la economía de puntos (encargo del 14 nov 2026).
--
-- Aplicar a mano en el SQL editor de Supabase DESPUÉS de la 0012, la 0017 y la
-- 0019. Es idempotente.
--
-- Contiene:
--   · puntos por ver (tick por minuto, idempotente por minuto) y racha
--   · caja diaria y caja de racha (el resultado lo decide el back con la
--     aleatoriedad verificable; aquí se registra y se abona atómicamente)
--   · lluvias (!lluvia / !maxwin)
--   · leaderboard mensual y reinicio mensual (reanudable paso a paso)
-- Todo cambio de saldo pasa por points_move.

SET search_path TO public;

-- ───────────────────────── tablas ─────────────────────────

-- Un minuto = una fila. La inserción es la guarda de idempotencia del tick:
-- dos ejecuciones del mismo minuto no pagan dos veces.
CREATE TABLE IF NOT EXISTS watch_ticks (
  minute bigint PRIMARY KEY,          -- floor(epoch / 60)
  day date NOT NULL,                  -- día de directo al que se imputó
  users_paid integer NOT NULL DEFAULT 0,
  points_total bigint NOT NULL DEFAULT 0,
  created_at integer NOT NULL
);

-- Racha de días de directo. No se reinicia con el mes.
CREATE TABLE IF NOT EXISTS user_streaks (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak integer NOT NULL DEFAULT 0,
  best_streak integer NOT NULL DEFAULT 0,
  last_day date,                      -- último día de directo en que alcanzó los minutos
  updated_at integer NOT NULL
);

-- Una caja diaria por usuario y día de directo.
CREATE TABLE IF NOT EXISTS daily_box_claims (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL,
  tier_id text,
  prize_kind text,                    -- points | item
  prize_name text,
  points integer NOT NULL DEFAULT 0,
  fallback boolean NOT NULL DEFAULT false,
  server_seed_hash text,
  client_seed text,
  nonce bigint,
  roll jsonb,
  opening_id bigint,                  -- loot_box_openings.id si el premio es un objeto
  created_at integer NOT NULL,
  UNIQUE (user_id, day)
);

-- Cajas de racha concedidas (una por cada múltiplo de la racha alcanzado).
CREATE TABLE IF NOT EXISTS streak_box_entitlements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL,                  -- día de directo en que se alcanzó
  streak_days integer NOT NULL,
  granted_at integer NOT NULL,
  opened_at integer,
  tier_label text,
  points integer,
  server_seed_hash text,
  client_seed text,
  nonce bigint,
  roll jsonb,
  UNIQUE (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_streak_box_unopened
  ON streak_box_entitlements (user_id) WHERE opened_at IS NULL;

-- Lluvias repartidas. El límite es por directo (desde el inicio de la sesión abierta).
CREATE TABLE IF NOT EXISTS rain_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('lluvia', 'maxwin')),
  points integer NOT NULL,
  window_seconds integer NOT NULL,
  issuer_platform text,
  issuer_id text,
  event_id text UNIQUE,               -- id del mensaje del webhook (reintentos)
  stream_session_id bigint,
  stream_started_at integer NOT NULL,
  recipients integer NOT NULL DEFAULT 0,
  total_points bigint NOT NULL DEFAULT 0,
  created_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rain_events_stream ON rain_events (kind, stream_started_at);

-- Un reinicio mensual por mes nuevo, con una marca por paso para reanudarlo.
CREATE TABLE IF NOT EXISTS monthly_resets (
  month text PRIMARY KEY,             -- mes que empieza (YYYY-MM)
  closed_month text NOT NULL,         -- mes que se cierra
  forced boolean NOT NULL DEFAULT false,
  started_at integer NOT NULL,
  locked_until integer,               -- arrendamiento: evita dos ejecuciones a la vez
  leaderboard_saved_at integer,
  auctions_closed_at integer,
  giveaways_closed_at integer,
  balances_reset_at integer,
  bonuses_granted_at integer,
  completed_at integer,
  auctions_closed integer,
  giveaways_closed integer,
  users_reset integer,
  bonus_users integer,
  error text,
  updated_at integer NOT NULL
);

-- Top 50 de cada mes cerrado (copia fiel del cálculo en el momento del reinicio).
CREATE TABLE IF NOT EXISTS monthly_leaderboard_results (
  month text NOT NULL,                -- mes cerrado (YYYY-MM)
  place integer NOT NULL,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username text,
  image text,
  points bigint NOT NULL,
  bonus_points integer NOT NULL DEFAULT 0,
  multiplier_pct integer NOT NULL DEFAULT 0,
  bonus_granted_at integer,
  PRIMARY KEY (month, place)
);
CREATE INDEX IF NOT EXISTS idx_monthly_results_user ON monthly_leaderboard_results (user_id);

-- Multiplicador del leaderboard: una fila por usuario, solo vale para `month`.
-- Sustituye al anterior; nunca se acumula.
CREATE TABLE IF NOT EXISTS user_month_bonus (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  month text NOT NULL,                -- mes en que se aplica
  multiplier_pct integer NOT NULL DEFAULT 0,
  source_month text NOT NULL,
  place integer,
  updated_at integer NOT NULL
);

-- Unidades entregadas de cada objeto en cada mes (stock mensual).
CREATE TABLE IF NOT EXISTS box_item_stock (
  month text NOT NULL,
  item_key text NOT NULL,
  used integer NOT NULL DEFAULT 0,
  PRIMARY KEY (month, item_key)
);

-- Suma de watch + rain de un mes sin recorrer todo el libro.
CREATE INDEX IF NOT EXISTS idx_point_transactions_month_board
  ON point_transactions (created_at, user_id) INCLUDE (amount)
  WHERE kind IN ('watch', 'rain');

-- ───────────────────── ayudas de tiempo y de directo ─────────────────────

-- Primer instante del mes 'YYYY-MM' en hora de Andorra.
CREATE OR REPLACE FUNCTION economy_month_start(p_month text) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT extract(epoch FROM (to_date(p_month || '-01', 'YYYY-MM-DD')::timestamp AT TIME ZONE 'Europe/Andorra'))::integer
$$;

CREATE OR REPLACE FUNCTION economy_month_end(p_month text) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT extract(epoch FROM ((to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month')::timestamp AT TIME ZONE 'Europe/Andorra'))::integer
$$;

-- Día de directo de referencia: el de la sesión abierta; si no hay, el último con directo.
CREATE OR REPLACE FUNCTION economy_live_day() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT min(day) FROM stream_sessions WHERE ended_at IS NULL),
    (SELECT max(day) FROM live_days)
  )
$$;

CREATE OR REPLACE FUNCTION economy_prev_live_day(p_day date) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT max(day) FROM live_days WHERE day < p_day
$$;

-- ───────────────────── tick de puntos por minuto ─────────────────────
-- Paga a cada usuario no baneado con actividad de chat dentro de la ventana:
--   floor(base × (100 + bonus de racha + bonus del mes) / 100)
-- Bonus de racha: solo si la racha está VIVA (su último día cualificado es el
-- día de directo actual o el anterior) y llega a bonusFromDay.
-- La racha sube cuando el usuario alcanza p_streak_minutes en el día de directo:
-- +1 si su último día era el día de directo anterior; si no, vuelve a 1.
-- Todo en una transacción; la inserción en watch_ticks hace el minuto idempotente.

CREATE OR REPLACE FUNCTION economy_watch_tick(
  p_points_per_minute integer,
  p_chat_window_seconds integer,
  p_streak_minutes integer,
  p_bonus_from_day integer,
  p_bonus_pct integer,
  p_box_every integer
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_minute bigint := floor(extract(epoch FROM now()) / 60)::bigint;
  v_month text := ad_month(extract(epoch FROM now())::integer);
  v_day date;
  v_prev date;
  v_started integer;
  r record;
  v_cur integer;
  v_best integer;
  v_last date;
  v_alive boolean;
  v_streak_pct integer;
  v_month_pct integer;
  v_points integer;
  v_minutes integer;
  v_new integer;
  v_paid integer := 0;
  v_total bigint := 0;
BEGIN
  IF p_points_per_minute < 1 OR p_chat_window_seconds < 1 OR p_streak_minutes < 1
     OR p_bonus_pct < 0 OR p_box_every < 0 THEN
    RAISE EXCEPTION 'INVALID_ECONOMY_CONFIG';
  END IF;

  SELECT min(day), min(started_at) INTO v_day, v_started
    FROM stream_sessions WHERE ended_at IS NULL;
  IF v_day IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_LIVE');
  END IF;

  INSERT INTO watch_ticks (minute, day, created_at) VALUES (v_minute, v_day, v_now)
  ON CONFLICT (minute) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'minute', v_minute, 'paid', 0, 'points', 0);
  END IF;

  INSERT INTO live_days (day, first_started_at) VALUES (v_day, v_started)
  ON CONFLICT (day) DO NOTHING;
  v_prev := economy_prev_live_day(v_day);

  FOR r IN
    SELECT u.id
      FROM chat_activity ca
      JOIN users u ON u.id = ca.user_id
     WHERE ca.last_chat_at >= v_now - p_chat_window_seconds
       AND NOT COALESCE(u.is_banned, false)
     ORDER BY u.id
  LOOP
    v_cur := NULL; v_best := NULL; v_last := NULL;
    SELECT current_streak, best_streak, last_day INTO v_cur, v_best, v_last
      FROM user_streaks WHERE user_id = r.id FOR UPDATE;

    v_alive := v_last IS NOT NULL AND (v_last = v_day OR v_last = v_prev);
    v_streak_pct := CASE WHEN v_alive AND COALESCE(v_cur, 0) >= p_bonus_from_day THEN p_bonus_pct ELSE 0 END;
    v_month_pct := COALESCE(
      (SELECT multiplier_pct FROM user_month_bonus WHERE user_id = r.id AND month = v_month), 0);

    v_points := (p_points_per_minute * (100 + v_streak_pct + v_month_pct)) / 100;
    IF v_points > 0 THEN
      PERFORM points_move(
        r.id, v_points, 'credit', 'watch', 'watch_tick', v_minute::text,
        'watch:' || r.id || ':' || v_minute
      );
      v_paid := v_paid + 1;
      v_total := v_total + v_points;
    END IF;

    INSERT INTO user_watch_days (user_id, day, minutes) VALUES (r.id, v_day, 1)
    ON CONFLICT (user_id, day) DO UPDATE SET minutes = user_watch_days.minutes + 1
    RETURNING minutes INTO v_minutes;

    IF v_minutes >= p_streak_minutes AND (v_last IS NULL OR v_last < v_day) THEN
      v_new := CASE
        WHEN v_prev IS NOT NULL AND v_last = v_prev THEN COALESCE(v_cur, 0) + 1
        ELSE 1
      END;

      INSERT INTO user_streaks (user_id, current_streak, best_streak, last_day, updated_at)
      VALUES (r.id, v_new, v_new, v_day, v_now)
      ON CONFLICT (user_id) DO UPDATE
        SET current_streak = v_new,
            best_streak = GREATEST(user_streaks.best_streak, v_new),
            last_day = v_day,
            updated_at = v_now;

      IF p_box_every > 0 AND v_new % p_box_every = 0 THEN
        INSERT INTO streak_box_entitlements (user_id, day, streak_days, granted_at)
        VALUES (r.id, v_day, v_new, v_now)
        ON CONFLICT (user_id, day) DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  UPDATE watch_ticks SET users_paid = v_paid, points_total = v_total WHERE minute = v_minute;
  DELETE FROM watch_ticks WHERE minute < v_minute - 4320;

  RETURN jsonb_build_object(
    'ok', true, 'duplicate', false, 'minute', v_minute, 'day', v_day,
    'paid', v_paid, 'points', v_total
  );
END $$;

-- ───────────────────── caja diaria ─────────────────────
-- El back ya ha decidido el tramo y los puntos con la aleatoriedad verificable
-- (nonce reservado con fair_reserve). Aquí se comprueba la disponibilidad, se
-- registra la apertura, se gestiona el stock mensual del objeto y se abona.
-- Errores: USER_NOT_FOUND, USER_BANNED, DAILY_BOX_NOT_AVAILABLE.

CREATE OR REPLACE FUNCTION economy_open_daily_box(
  p_user_id integer,
  p_box_minutes integer,
  p_tier_id text,
  p_kind text,                 -- points | item
  p_name text,
  p_points integer,            -- puntos del tramo (kind = points)
  p_item_stock integer,        -- stock mensual (kind = item)
  p_fallback_points integer,   -- puntos si el objeto se agota (kind = item)
  p_server_seed_hash text,
  p_client_seed text,
  p_nonce bigint,
  p_roll jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_month text := ad_month(extract(epoch FROM now())::integer);
  v_banned boolean;
  v_day date;
  v_minutes integer;
  v_claim bigint;
  v_used integer;
  v_fallback boolean := false;
  v_points integer := 0;
  v_opening bigint;
  v_balance integer;
  v_kind text := p_kind;
BEGIN
  IF p_kind NOT IN ('points', 'item') THEN
    RAISE EXCEPTION 'INVALID_PRIZE';
  END IF;

  SELECT COALESCE(is_banned, false) INTO v_banned FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF v_banned THEN RAISE EXCEPTION 'USER_BANNED'; END IF;

  v_day := economy_live_day();
  IF v_day IS NULL THEN RAISE EXCEPTION 'DAILY_BOX_NOT_AVAILABLE'; END IF;

  SELECT minutes INTO v_minutes FROM user_watch_days WHERE user_id = p_user_id AND day = v_day;
  IF COALESCE(v_minutes, 0) < p_box_minutes THEN
    RAISE EXCEPTION 'DAILY_BOX_NOT_AVAILABLE';
  END IF;

  INSERT INTO daily_box_claims (user_id, day, created_at) VALUES (p_user_id, v_day, v_now)
  ON CONFLICT (user_id, day) DO NOTHING
  RETURNING id INTO v_claim;
  IF v_claim IS NULL THEN RAISE EXCEPTION 'DAILY_BOX_NOT_AVAILABLE'; END IF;

  IF p_kind = 'points' THEN
    v_points := p_points;
  ELSE
    INSERT INTO box_item_stock (month, item_key, used) VALUES (v_month, 'daily:' || p_tier_id, 0)
    ON CONFLICT (month, item_key) DO NOTHING;
    SELECT used INTO v_used FROM box_item_stock
     WHERE month = v_month AND item_key = 'daily:' || p_tier_id FOR UPDATE;

    IF v_used < p_item_stock THEN
      UPDATE box_item_stock SET used = used + 1
       WHERE month = v_month AND item_key = 'daily:' || p_tier_id;
    ELSE
      v_fallback := true;
      v_kind := 'points';
      v_points := p_fallback_points;
    END IF;
  END IF;

  IF v_kind = 'item' THEN
    INSERT INTO loot_box_openings
      (user_id, box_id, prize_id, box_name, prize_name, rarity, kind,
       points_awarded, price_paid, status, created_at)
    VALUES
      (p_user_id, NULL, NULL, 'Caja diaria', p_name, p_tier_id, 'item', 0, 0, 'pending', v_now)
    RETURNING id INTO v_opening;
  END IF;

  IF v_points > 0 THEN
    v_balance := points_move(
      p_user_id, v_points, 'credit', 'daily_box', 'daily_box_claim', v_claim::text,
      'daily_box:' || p_user_id || ':' || v_day,
      jsonb_build_object('tier', p_tier_id, 'fallback', v_fallback)
    );
  ELSE
    SELECT total_points - used_points INTO v_balance FROM users WHERE id = p_user_id;
  END IF;

  UPDATE daily_box_claims
     SET tier_id = p_tier_id, prize_kind = v_kind, prize_name = p_name, points = v_points,
         fallback = v_fallback, server_seed_hash = p_server_seed_hash, client_seed = p_client_seed,
         nonce = p_nonce, roll = p_roll, opening_id = v_opening
   WHERE id = v_claim;

  RETURN jsonb_build_object(
    'tier', p_tier_id, 'kind', v_kind, 'name', p_name, 'points', v_points,
    'fallback', v_fallback, 'balance', v_balance, 'opening_id', v_opening
  );
END $$;

-- ───────────────────── caja de racha ─────────────────────
-- Consume la entrada sin abrir más antigua. Errores: USER_NOT_FOUND,
-- USER_BANNED, STREAK_BOX_NOT_AVAILABLE.

CREATE OR REPLACE FUNCTION economy_open_streak_box(
  p_user_id integer,
  p_tier_label text,
  p_points integer,
  p_server_seed_hash text,
  p_client_seed text,
  p_nonce bigint,
  p_roll jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_banned boolean;
  v_ent bigint;
  v_balance integer;
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT COALESCE(is_banned, false) INTO v_banned FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF v_banned THEN RAISE EXCEPTION 'USER_BANNED'; END IF;

  SELECT id INTO v_ent FROM streak_box_entitlements
   WHERE user_id = p_user_id AND opened_at IS NULL
   ORDER BY id LIMIT 1 FOR UPDATE;
  IF v_ent IS NULL THEN RAISE EXCEPTION 'STREAK_BOX_NOT_AVAILABLE'; END IF;

  UPDATE streak_box_entitlements
     SET opened_at = v_now, tier_label = p_tier_label, points = p_points,
         server_seed_hash = p_server_seed_hash, client_seed = p_client_seed,
         nonce = p_nonce, roll = p_roll
   WHERE id = v_ent;

  v_balance := points_move(
    p_user_id, p_points, 'credit', 'streak_box', 'streak_box_entitlement', v_ent::text,
    'streak_box:' || v_ent,
    jsonb_build_object('tier', p_tier_label)
  );

  RETURN jsonb_build_object('entitlement_id', v_ent, 'points', p_points, 'balance', v_balance);
END $$;

-- ───────────────────── lluvias ─────────────────────
-- Reparte p_points a cada usuario no baneado con actividad de chat en la
-- ventana, una vez por usuario. Límite por directo: se cuentan las lluvias del
-- mismo tipo desde el inicio de la sesión abierta más antigua. Un reintento con
-- el mismo p_event_id devuelve el resultado anterior sin pagar otra vez, y dos
-- órdenes del mismo emisor con menos de 10 s de diferencia cuentan como una.

CREATE OR REPLACE FUNCTION economy_grant_rain(
  p_kind text,
  p_points integer,
  p_window_seconds integer,
  p_max integer,
  p_issuer_platform text,
  p_issuer_id text,
  p_event_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_started integer;
  v_session bigint;
  v_prev rain_events%ROWTYPE;
  v_id bigint;
  v_count integer;
  v_recipients integer := 0;
  r record;
BEGIN
  IF p_kind NOT IN ('lluvia', 'maxwin') OR p_points < 1 OR p_window_seconds < 1 OR p_max < 0 THEN
    RAISE EXCEPTION 'INVALID_ECONOMY_CONFIG';
  END IF;

  -- Serializa el control de límites de todas las lluvias.
  PERFORM pg_advisory_xact_lock(7210021);

  IF p_event_id IS NOT NULL THEN
    SELECT * INTO v_prev FROM rain_events WHERE event_id = p_event_id;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true,
        'recipients', v_prev.recipients, 'points', v_prev.points);
    END IF;
  END IF;

  SELECT min(started_at), min(id) INTO v_started, v_session
    FROM stream_sessions WHERE ended_at IS NULL;
  IF v_started IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_LIVE');
  END IF;

  IF p_max = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LIMIT_REACHED');
  END IF;

  IF p_issuer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM rain_events
     WHERE issuer_platform IS NOT DISTINCT FROM p_issuer_platform
       AND issuer_id = p_issuer_id AND created_at > v_now - 10
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LIMIT_REACHED');
  END IF;

  SELECT count(*) INTO v_count FROM rain_events
   WHERE kind = p_kind AND stream_started_at >= v_started;
  IF v_count >= p_max THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LIMIT_REACHED');
  END IF;

  INSERT INTO rain_events
    (kind, points, window_seconds, issuer_platform, issuer_id, event_id,
     stream_session_id, stream_started_at, created_at)
  VALUES
    (p_kind, p_points, p_window_seconds, p_issuer_platform, p_issuer_id, p_event_id,
     v_session, v_started, v_now)
  RETURNING id INTO v_id;

  FOR r IN
    SELECT u.id
      FROM chat_activity ca
      JOIN users u ON u.id = ca.user_id
     WHERE ca.last_chat_at >= v_now - p_window_seconds
       AND NOT COALESCE(u.is_banned, false)
     ORDER BY u.id
  LOOP
    PERFORM points_move(
      r.id, p_points, 'credit', 'rain', 'rain_event', v_id::text,
      'rain:' || v_id || ':' || r.id,
      jsonb_build_object('kind', p_kind)
    );
    v_recipients := v_recipients + 1;
  END LOOP;

  UPDATE rain_events
     SET recipients = v_recipients, total_points = v_recipients::bigint * p_points
   WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'id', v_id,
    'recipients', v_recipients, 'points', p_points);
END $$;

-- ───────────────────── leaderboard mensual ─────────────────────
-- Puntos ganados viendo en el mes: SOLO movimientos `watch` y `rain`.
-- Excluye baneados. Empate: gana el usuario con id menor. Devuelve
-- { entries: [{ place, user_id, username, image, points }], me: {place, points} | null }.

CREATE OR REPLACE FUNCTION economy_month_board(
  p_month text,
  p_user_id integer DEFAULT NULL,
  p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path FROM CURRENT
AS $$
DECLARE
  v_start integer := economy_month_start(p_month);
  v_end integer := economy_month_end(p_month);
BEGIN
  RETURN (
    WITH totals AS (
      SELECT pt.user_id, SUM(pt.amount)::bigint AS pts
        FROM point_transactions pt
       WHERE pt.kind IN ('watch', 'rain')
         AND pt.created_at >= v_start AND pt.created_at < v_end
       GROUP BY pt.user_id
      HAVING SUM(pt.amount) > 0
    ), ranked AS (
      SELECT t.user_id, t.pts, u.username, u.image,
             row_number() OVER (ORDER BY t.pts DESC, t.user_id ASC)::integer AS place
        FROM totals t
        JOIN users u ON u.id = t.user_id
       WHERE NOT COALESCE(u.is_banned, false)
    )
    SELECT jsonb_build_object(
      'entries', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'place', place, 'user_id', user_id, 'username', username,
                 'image', image, 'points', pts) ORDER BY place)
          FROM ranked WHERE place <= p_limit
      ), '[]'::jsonb),
      'me', (
        SELECT jsonb_build_object('place', place, 'points', pts)
          FROM ranked WHERE user_id = p_user_id
      )
    )
  );
END $$;

-- ───────────────────── reinicio mensual ─────────────────────

-- Abre (o retoma) el reinicio del mes y toma un arrendamiento para que dos
-- ejecuciones no corran a la vez. state: claimed | locked | done.
CREATE OR REPLACE FUNCTION economy_reset_begin(
  p_month text,
  p_closed text,
  p_forced boolean,
  p_lease_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  r monthly_resets%ROWTYPE;
BEGIN
  INSERT INTO monthly_resets (month, closed_month, forced, started_at, updated_at)
  VALUES (p_month, p_closed, p_forced, v_now, v_now)
  ON CONFLICT (month) DO NOTHING;

  SELECT * INTO r FROM monthly_resets WHERE month = p_month FOR UPDATE;

  IF r.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('state', 'done', 'row', to_jsonb(r));
  END IF;
  IF r.locked_until IS NOT NULL AND r.locked_until > v_now THEN
    RETURN jsonb_build_object('state', 'locked', 'row', to_jsonb(r));
  END IF;

  UPDATE monthly_resets SET locked_until = v_now + p_lease_seconds, error = NULL, updated_at = v_now
   WHERE month = p_month;
  RETURN jsonb_build_object('state', 'claimed', 'row', to_jsonb(r));
END $$;

-- Paso 1: guarda el top del mes que se cierra, con el bono que le toca a cada
-- puesto según la escala vigente. Va ANTES de tocar nada. p_scale =
-- [{from,to,points,multiplierPct}].
CREATE OR REPLACE FUNCTION economy_reset_save_leaderboard(
  p_month text,
  p_closed text,
  p_scale jsonb,
  p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_start integer := economy_month_start(p_closed);
  v_end integer := economy_month_end(p_closed);
  v_saved integer;
  v_count integer;
BEGIN
  SELECT leaderboard_saved_at INTO v_saved FROM monthly_resets WHERE month = p_month FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESET_NOT_STARTED'; END IF;
  IF v_saved IS NOT NULL THEN
    RETURN jsonb_build_object('saved', false, 'already', true);
  END IF;

  INSERT INTO monthly_leaderboard_results
    (month, place, user_id, username, image, points, bonus_points, multiplier_pct)
  SELECT p_closed, rk.place, rk.user_id, rk.username, rk.image, rk.pts,
         COALESCE(s.bp, 0), COALESCE(s.mp, 0)
    FROM (
      SELECT t.user_id, t.pts, u.username, u.image,
             row_number() OVER (ORDER BY t.pts DESC, t.user_id ASC)::integer AS place
        FROM (
          SELECT pt.user_id, SUM(pt.amount)::bigint AS pts
            FROM point_transactions pt
           WHERE pt.kind IN ('watch', 'rain')
             AND pt.created_at >= v_start AND pt.created_at < v_end
           GROUP BY pt.user_id
          HAVING SUM(pt.amount) > 0
        ) t
        JOIN users u ON u.id = t.user_id
       WHERE NOT COALESCE(u.is_banned, false)
    ) rk
    LEFT JOIN LATERAL (
      SELECT (e->>'points')::integer AS bp, (e->>'multiplierPct')::integer AS mp
        FROM jsonb_array_elements(p_scale) e
       WHERE (e->>'from')::integer <= rk.place AND (e->>'to')::integer >= rk.place
       LIMIT 1
    ) s ON true
   WHERE rk.place <= p_limit
  ON CONFLICT (month, place) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE monthly_resets SET leaderboard_saved_at = v_now, updated_at = v_now WHERE month = p_month;
  RETURN jsonb_build_object('saved', true, 'rows', v_count);
END $$;

-- Paso 4: saldos a cero con un movimiento `monthly_reset` por usuario con saldo.
-- Procesa como mucho p_limit usuarios por llamada; repetir hasta remaining = 0.
-- La clave de idempotencia evita repetir el movimiento de un usuario.
CREATE OR REPLACE FUNCTION economy_reset_balances(p_month text, p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r record;
  v_bal integer;
  v_done integer := 0;
  v_remaining integer;
BEGIN
  FOR r IN
    SELECT u.id FROM users u
     WHERE u.total_points - u.used_points > 0
       AND NOT EXISTS (
         SELECT 1 FROM point_transactions pt
          WHERE pt.idempotency_key = 'monthly_reset:' || p_month || ':' || u.id)
     ORDER BY u.id
     LIMIT p_limit
  LOOP
    SELECT total_points - used_points INTO v_bal FROM users WHERE id = r.id FOR UPDATE;
    IF v_bal > 0 THEN
      PERFORM points_move(
        r.id, v_bal, 'revoke', 'monthly_reset', 'monthly_reset', p_month,
        'monthly_reset:' || p_month || ':' || r.id
      );
      v_done := v_done + 1;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_remaining FROM users u
   WHERE u.total_points - u.used_points > 0
     AND NOT EXISTS (
       SELECT 1 FROM point_transactions pt
        WHERE pt.idempotency_key = 'monthly_reset:' || p_month || ':' || u.id);

  RETURN jsonb_build_object('processed', v_done, 'remaining', v_remaining);
END $$;

-- Paso 5: puntos del leaderboard y multiplicador del mes nuevo (sustituye al
-- anterior; nunca se acumula).
CREATE OR REPLACE FUNCTION economy_reset_grant_bonuses(p_month text, p_closed text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  r monthly_leaderboard_results%ROWTYPE;
  v_users integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM monthly_leaderboard_results
     WHERE month = p_closed AND bonus_granted_at IS NULL
     ORDER BY place
  LOOP
    IF r.bonus_points > 0 THEN
      PERFORM points_move(
        r.user_id, r.bonus_points, 'credit', 'leaderboard_bonus', 'monthly_leaderboard',
        p_closed || ':' || r.place,
        'lb_bonus:' || p_closed || ':' || r.user_id,
        jsonb_build_object('place', r.place, 'month', p_closed)
      );
    END IF;

    INSERT INTO user_month_bonus (user_id, month, multiplier_pct, source_month, place, updated_at)
    VALUES (r.user_id, p_month, r.multiplier_pct, p_closed, r.place, v_now)
    ON CONFLICT (user_id) DO UPDATE
      SET month = p_month, multiplier_pct = r.multiplier_pct, source_month = p_closed,
          place = r.place, updated_at = v_now;

    UPDATE monthly_leaderboard_results SET bonus_granted_at = v_now
     WHERE month = r.month AND place = r.place;
    v_users := v_users + 1;
  END LOOP;

  RETURN jsonb_build_object('granted', v_users);
END $$;

-- ───────────────────── permisos ─────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'economy_month_start(text)',
    'economy_month_end(text)',
    'economy_live_day()',
    'economy_prev_live_day(date)',
    'economy_watch_tick(integer, integer, integer, integer, integer, integer)',
    'economy_open_daily_box(integer, integer, text, text, text, integer, integer, integer, text, text, bigint, jsonb)',
    'economy_open_streak_box(integer, text, integer, text, text, bigint, jsonb)',
    'economy_grant_rain(text, integer, integer, integer, text, text, text)',
    'economy_month_board(text, integer, integer)',
    'economy_reset_begin(text, text, boolean, integer)',
    'economy_reset_save_leaderboard(text, text, jsonb, integer)',
    'economy_reset_balances(text, integer)',
    'economy_reset_grant_bonuses(text, text)'
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
  FOREACH t IN ARRAY ARRAY[
    'watch_ticks', 'user_streaks', 'daily_box_claims', 'streak_box_entitlements',
    'rain_events', 'monthly_resets', 'monthly_leaderboard_results',
    'user_month_bonus', 'box_item_stock'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('GRANT ALL ON TABLE %I TO service_role', t);
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
