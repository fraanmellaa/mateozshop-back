-- 0037 · Economía final (18 nov 2026): eventos, racha diaria, caja diaria,
-- ranking mensual y premio mensual de TikTok.
--
--  · Eventos: tres comandos (!lluvia, !bigwin, !maxwin). Cada uno apunta sus
--    puntos con su propio motivo ('rain', 'bigwin', 'maxwin').
--  · Racha: puntos cada día de directo al llegar a los minutos de racha
--    (50, 100, 150… hasta el tope) y un extra fijo cada 7 días seguidos.
--    Desaparecen el +10 % por racha y la caja de racha.
--  · Ranking mensual: solo cuentan los puntos por ver el directo ('watch');
--    en caso de empate gana la racha más larga.
--  · TikTok: premio mensual en puntos que el administrador entrega a mano.
--
-- Se puede aplicar varias veces. No cambia la forma de llamar a ninguna
-- función que use el código anterior: economy_watch_tick admite los seis
-- parámetros de antes (los tres del bonus y la caja de racha se ignoran) y los
-- nuevos van al final con valor por defecto.

SET search_path TO public;

-- ───────────────────── eventos del directo ─────────────────────

ALTER TABLE rain_events DROP CONSTRAINT IF EXISTS rain_events_kind_check;
ALTER TABLE rain_events
  ADD CONSTRAINT rain_events_kind_check CHECK (kind IN ('lluvia', 'bigwin', 'maxwin'));

-- Reparte un evento entre quienes escribieron en el chat dentro de la ventana
-- ANTERIOR al comando: el reparto ocurre en el instante del comando, así que un
-- mensaje posterior nunca entra. Máximo por directo y por tipo de evento.
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
  -- Motivo en el libro de puntos: la lluvia conserva 'rain'.
  v_tx_kind text := CASE p_kind WHEN 'lluvia' THEN 'rain' ELSE p_kind END;
  r record;
BEGIN
  IF p_kind NOT IN ('lluvia', 'bigwin', 'maxwin') OR p_points < 1 OR p_window_seconds < 1 OR p_max < 0 THEN
    RAISE EXCEPTION 'INVALID_ECONOMY_CONFIG';
  END IF;

  -- Una sola lluvia a la vez: el recuento y el alta no se pisan.
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

  -- El mismo emisor no lanza dos eventos en 10 segundos (doble envío del comando).
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
       AND ca.last_chat_at <= v_now
       AND NOT COALESCE(u.is_banned, false)
     ORDER BY u.id
  LOOP
    PERFORM points_move(
      r.id, p_points, 'credit', v_tx_kind, 'rain_event', v_id::text,
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

-- ───────────────────── minuto de directo y racha ─────────────────────

-- La versión anterior tenía seis parámetros; la nueva añade los de la racha al
-- final con valor por defecto, así que las llamadas antiguas siguen valiendo.
DROP FUNCTION IF EXISTS economy_watch_tick(integer, integer, integer, integer, integer, integer);

-- Paga un minuto de directo a quien ha escrito en el chat dentro de la ventana
-- y, la primera vez que alguien llega hoy a los minutos de racha, le sube la
-- racha y le paga los puntos de ese día (p_streak_first el día 1, p_streak_step
-- más cada día, hasta p_streak_max) y el extra de cada p_week_every días.
-- Cuenta por días de directo: faltar a un día de directo devuelve al día 1.
-- p_bonus_from_day, p_bonus_pct y p_box_every ya no se usan (el +10 % por racha
-- y la caja de racha se han quitado); se conservan para las llamadas antiguas.
CREATE OR REPLACE FUNCTION economy_watch_tick(
  p_points_per_minute integer,
  p_chat_window_seconds integer,
  p_streak_minutes integer,
  p_bonus_from_day integer DEFAULT NULL,
  p_bonus_pct integer DEFAULT NULL,
  p_box_every integer DEFAULT NULL,
  p_streak_first integer DEFAULT 50,
  p_streak_step integer DEFAULT 50,
  p_streak_max integer DEFAULT 300,
  p_week_every integer DEFAULT 7,
  p_week_points integer DEFAULT 1000
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
  v_month_pct integer;
  v_points integer;
  v_minutes integer;
  v_new integer;
  v_streak_points integer;
  v_paid integer := 0;
  v_total bigint := 0;
  v_streak_users integer := 0;
  v_streak_total bigint := 0;
BEGIN
  IF p_points_per_minute < 1 OR p_chat_window_seconds < 1 OR p_streak_minutes < 1
     OR p_streak_first < 0 OR p_streak_step < 0 OR p_streak_max < 0
     OR p_week_every < 0 OR p_week_points < 0 THEN
    RAISE EXCEPTION 'INVALID_ECONOMY_CONFIG';
  END IF;

  -- Sin ningún directo abierto no se paga nada.
  SELECT min(day), min(started_at) INTO v_day, v_started
    FROM stream_sessions WHERE ended_at IS NULL;
  IF v_day IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_LIVE');
  END IF;

  -- Un minuto se paga una sola vez aunque el cron se solape o se repita.
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

    -- Solo queda el posible porcentaje del leaderboard del mes anterior (hoy a 0).
    v_month_pct := COALESCE(
      (SELECT multiplier_pct FROM user_month_bonus WHERE user_id = r.id AND month = v_month), 0);
    v_points := (p_points_per_minute * (100 + v_month_pct)) / 100;

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

    -- Primera vez que hoy llega a los minutos de racha: sube la racha y cobra.
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

      v_streak_points := LEAST(p_streak_first + (v_new - 1) * p_streak_step, p_streak_max);
      IF v_streak_points > 0 THEN
        PERFORM points_move(
          r.id, v_streak_points, 'credit', 'streak', 'streak_day', v_day::text,
          'streak:' || r.id || ':' || v_day,
          jsonb_build_object('day', v_new)
        );
        v_streak_users := v_streak_users + 1;
        v_streak_total := v_streak_total + v_streak_points;
      END IF;

      IF p_week_every > 0 AND p_week_points > 0 AND v_new % p_week_every = 0 THEN
        PERFORM points_move(
          r.id, p_week_points, 'credit', 'streak_week', 'streak_day', v_day::text,
          'streak_week:' || r.id || ':' || v_day,
          jsonb_build_object('day', v_new)
        );
        v_streak_total := v_streak_total + p_week_points;
      END IF;
    END IF;
  END LOOP;

  UPDATE watch_ticks SET users_paid = v_paid, points_total = v_total WHERE minute = v_minute;
  DELETE FROM watch_ticks WHERE minute < v_minute - 4320;

  RETURN jsonb_build_object(
    'ok', true, 'duplicate', false, 'minute', v_minute, 'day', v_day,
    'paid', v_paid, 'points', v_total,
    'streak_users', v_streak_users, 'streak_points', v_streak_total
  );
END $$;

-- ───────────────────── caja de racha: retirada ─────────────────────

-- Ya no se reparten cajas de racha. Las que quedaran sin abrir se dan por
-- cerradas sin premio para que nadie vea una caja que no se puede abrir.
UPDATE streak_box_entitlements
   SET opened_at = extract(epoch FROM now())::integer, points = 0, tier_label = 'retirada'
 WHERE opened_at IS NULL;

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
BEGIN
  RAISE EXCEPTION 'STREAK_BOX_NOT_AVAILABLE';
END $$;

-- ───────────────────── ranking mensual ─────────────────────

-- Puestos del mes. Solo cuentan los puntos ganados viendo el directo ('watch').
-- Empate a puntos: gana la racha más larga (la racha en vigor: su último día
-- de racha es uno de los dos últimos días de directo); después, la mejor racha.
CREATE OR REPLACE FUNCTION economy_month_ranking(p_month text)
RETURNS TABLE (place integer, user_id integer, pts bigint, username text, image text)
LANGUAGE plpgsql STABLE
SET search_path FROM CURRENT
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH totals AS (
    SELECT pt.user_id, SUM(pt.amount)::bigint AS pts
      FROM point_transactions pt
     WHERE pt.kind = 'watch'
       AND pt.created_at >= economy_month_start(p_month)
       AND pt.created_at < economy_month_end(p_month)
     GROUP BY pt.user_id
    HAVING SUM(pt.amount) > 0
  ), last_days AS (
    SELECT min(d.day) AS since FROM (SELECT ld.day FROM live_days ld ORDER BY ld.day DESC LIMIT 2) d
  )
  SELECT row_number() OVER (
           ORDER BY t.pts DESC,
                    CASE WHEN s.last_day IS NOT NULL AND s.last_day >= (SELECT since FROM last_days)
                         THEN s.current_streak ELSE 0 END DESC,
                    COALESCE(s.best_streak, 0) DESC,
                    t.user_id ASC
         )::integer,
         t.user_id, t.pts, u.username::text, u.image::text
    FROM totals t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN user_streaks s ON s.user_id = t.user_id
   WHERE NOT COALESCE(u.is_banned, false);
END $$;

CREATE OR REPLACE FUNCTION economy_month_board(
  p_month text,
  p_user_id integer DEFAULT NULL,
  p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path FROM CURRENT
AS $$
BEGIN
  RETURN (
    WITH ranked AS (
      SELECT * FROM economy_month_ranking(p_month)
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

-- Paso del reinicio mensual que guarda la foto del ranking del mes cerrado:
-- mismo criterio que el ranking en vivo (economy_month_ranking).
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
    FROM economy_month_ranking(p_closed) rk
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

-- ───────────────────── premio mensual de TikTok ─────────────────────

-- Los tres ganadores del mes los elige el administrador a mano en el panel.
CREATE TABLE IF NOT EXISTS tiktok_month_prizes (
  month text NOT NULL,                -- YYYY-MM (mes de Andorra)
  place integer NOT NULL CHECK (place BETWEEN 1 AND 3),
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points integer NOT NULL CHECK (points > 0),
  granted_by text,
  created_at integer NOT NULL,
  PRIMARY KEY (month, place),
  UNIQUE (month, user_id)
);

-- Entrega el premio de un puesto: una sola vez por puesto y mes, y un usuario
-- no puede ocupar dos puestos el mismo mes.
CREATE OR REPLACE FUNCTION tiktok_grant_month_prize(
  p_month text,
  p_place integer,
  p_user_id integer,
  p_points integer,
  p_admin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_banned boolean;
  v_balance integer;
BEGIN
  IF p_month IS NULL OR p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'INVALID_MONTH'; END IF;
  IF p_place IS NULL OR p_place < 1 OR p_place > 3 THEN RAISE EXCEPTION 'INVALID_PLACE'; END IF;
  IF p_points IS NULL OR p_points < 1 OR p_points > 1000000 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT COALESCE(is_banned, false) INTO v_banned FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF v_banned THEN RAISE EXCEPTION 'USER_BANNED'; END IF;

  -- Un solo reparto a la vez por mes: los dos avisos de abajo no se cruzan.
  PERFORM pg_advisory_xact_lock(7210037, hashtext(p_month));
  IF EXISTS (SELECT 1 FROM tiktok_month_prizes WHERE month = p_month AND place = p_place) THEN
    RAISE EXCEPTION 'PLACE_TAKEN';
  END IF;
  IF EXISTS (SELECT 1 FROM tiktok_month_prizes WHERE month = p_month AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'ALREADY_WINNER';
  END IF;

  INSERT INTO tiktok_month_prizes (month, place, user_id, points, granted_by, created_at)
  VALUES (p_month, p_place, p_user_id, p_points, p_admin, v_now);

  v_balance := points_move(
    p_user_id, p_points, 'credit', 'tiktok_prize', 'tiktok_month_prize', p_month || ':' || p_place,
    'tiktok_prize:' || p_month || ':' || p_place,
    jsonb_build_object('place', p_place, 'month', p_month)
  );
  RETURN jsonb_build_object('month', p_month, 'place', p_place, 'user_id', p_user_id,
    'points', p_points, 'balance', v_balance);
END $$;

-- ───────────────────── ajustes guardados ─────────────────────

-- Los ajustes guardados mandan sobre los valores por defecto del código: se
-- dejan aquí las cifras finales. Solo la primera vez (si la racha ya tiene el
-- formato nuevo no se toca nada, para no pisar lo que se cambie en el panel).
UPDATE app_settings
   SET value = value
         || jsonb_build_object(
              'minutes', COALESCE(value -> 'minutes', '{}'::jsonb) || '{"streak": 20, "dailyBox": 15}'::jsonb,
              'streak', '{"dailyFirst": 50, "dailyStep": 50, "dailyMax": 300, "weeklyEveryDays": 7, "weeklyPoints": 1000}'::jsonb,
              'rain', '{"lluvia": {"points": 150, "windowMinutes": 10, "maxPerStream": 3},
                        "bigwin": {"points": 300, "windowMinutes": 10, "maxPerStream": 2},
                        "maxwin": {"points": 1000, "windowMinutes": 10, "maxPerStream": 1}}'::jsonb,
              'dailyBox', '{"tiers": [
                 {"id": "p50", "label": "50 puntos", "weight": 5000, "kind": "points", "pointsMin": 50, "pointsMax": 50},
                 {"id": "p100", "label": "100 puntos", "weight": 3000, "kind": "points", "pointsMin": 100, "pointsMax": 100},
                 {"id": "p250", "label": "250 puntos", "weight": 1500, "kind": "points", "pointsMin": 250, "pointsMax": 250},
                 {"id": "p500", "label": "500 puntos", "weight": 400, "kind": "points", "pointsMin": 500, "pointsMax": 500},
                 {"id": "p2500", "label": "2.500 puntos", "weight": 100, "kind": "points", "pointsMin": 2500, "pointsMax": 2500}]}'::jsonb,
              'tiktok', '{"monthlyPrizes": [5000, 3000, 2000]}'::jsonb
            ),
       updated_at = extract(epoch FROM now())::integer
 WHERE key = 'economy'
   AND jsonb_typeof(value) = 'object'
   AND NOT (COALESCE(value -> 'streak', '{}'::jsonb) ? 'dailyFirst');

-- ───────────────────── permisos ─────────────────────

DO $$ BEGIN
  REVOKE ALL ON FUNCTION economy_watch_tick(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer) FROM PUBLIC;
  REVOKE ALL ON FUNCTION economy_month_ranking(text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION tiktok_grant_month_prize(text, integer, integer, integer, text) FROM PUBLIC;
  BEGIN
    REVOKE ALL ON FUNCTION economy_watch_tick(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION economy_month_ranking(text) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION tiktok_grant_month_prize(text, integer, integer, integer, text) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION economy_watch_tick(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION economy_month_ranking(text) TO service_role;
    GRANT EXECUTE ON FUNCTION tiktok_grant_month_prize(text, integer, integer, integer, text) TO service_role;
  EXCEPTION WHEN undefined_object THEN NULL; -- roles de Supabase ausentes
  END;
END $$;

ALTER TABLE tiktok_month_prizes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  GRANT ALL ON TABLE tiktok_month_prizes TO service_role;
EXCEPTION WHEN undefined_object THEN NULL; -- rol de Supabase ausente
END $$;

NOTIFY pgrst, 'reload schema';
