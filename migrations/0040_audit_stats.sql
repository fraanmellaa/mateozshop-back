-- 0040: números del panel y avisos de cuentas repetidas (19 nov 2026).
--
-- Aplicar a mano en el SQL editor de Supabase DESPUÉS de la 0036. Es idempotente
-- y no cambia ninguna función existente: el código antiguo sigue funcionando.
-- Mientras no esté aplicada, el panel enseña un aviso en «Números» y los pedidos
-- se ven igual que antes (sin avisos de cuentas repetidas).
--
-- Contiene:
--   · admin_stats(unidad, periodos): una fila por semana o por mes con los puntos
--     repartidos por origen, los gastados por destino, los premios puestos y
--     vendidos (precio final frente a salida) y las personas distintas con premio.
--   · Cuentas repetidas (solo aviso, no bloquea nada):
--       - orders.delivery_email, orders.casino_accounts y orders.winner_ip: se
--         guardan solos al crearse el pedido y otra vez al marcarlo entregado.
--       - user_ips: IP desde la que puja cada usuario (la apunta la ruta de pujar).
--       - orders_duplicate_flags(ids): avisos de cada pedido (correo de entrega o
--         usuario del casino que coinciden con los de otra cuenta, e IP compartida
--         con otra cuenta ganadora).

SET search_path TO public;

-- ───────────────────────── números del panel ─────────────────────────

-- El resumen recorre el libro de puntos por fecha.
CREATE INDEX IF NOT EXISTS idx_point_transactions_created_at
  ON point_transactions (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);

-- p_unit: 'week' (de lunes a domingo) o 'month'. p_periods: cuántos periodos
-- hacia atrás, contando el actual (máximo 60). Todo en hora de Andorra.
--
-- Puntos repartidos (movimientos del libro, por motivo):
--   watch → ver el directo · streak, streak_week y la antigua streak_box → racha
--   rain → lluvias · bigwin → big win · maxwin → max win · prediction → predicciones
--   daily_box → cajas gratis · leaderboard_bonus y tiktok_* → ranking
--   (una lluvia antigua guardada como 'rain' se reparte según rain_events.kind)
-- Puntos gastados:
--   pujas → lo pagado por los premios ganados (pedidos en puntos normales, sin
--            los cancelados). Lo retenido en pujas que siguen abiertas no cuenta.
--   tickets → giveaway_ticket menos giveaway_refund
--   cajas de pago → loot_box_open (pagado) y loot_box_prize (devuelto)
--   juegos → *_bet menos las apuestas canceladas (apostado) y *_payout (devuelto)
-- «other» recoge lo demás (ajustes a mano del panel, devoluciones); el borrado
-- del reinicio mensual no se cuenta en ningún sitio.
CREATE OR REPLACE FUNCTION admin_stats(p_unit text DEFAULT 'week', p_periods integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path FROM CURRENT
AS $$
DECLARE
  v_unit text := CASE WHEN p_unit = 'month' THEN 'month' ELSE 'week' END;
  v_n integer := LEAST(GREATEST(COALESCE(p_periods, 12), 1), 60);
  v_step interval := CASE WHEN p_unit = 'month' THEN interval '1 month' ELSE interval '1 week' END;
  v_last timestamp := date_trunc(v_unit, now() AT TIME ZONE 'Europe/Andorra');
  v_first timestamp;
  v_from integer;
  v_periods jsonb;
  v_sold jsonb;
BEGIN
  v_first := v_last - (v_n - 1) * v_step;
  v_from := extract(epoch FROM (v_first AT TIME ZONE 'Europe/Andorra'))::integer;

  WITH periods AS (
    SELECT g::date AS start, (g + v_step)::date AS next_start
      FROM generate_series(v_first, v_last, v_step) g
  ),
  tx AS (
    SELECT date_trunc(v_unit, to_timestamp(pt.created_at) AT TIME ZONE 'Europe/Andorra')::date AS start,
           CASE
             WHEN pt.kind = 'watch' THEN 'watch'
             WHEN pt.kind IN ('streak', 'streak_week', 'streak_box') THEN 'streak'
             WHEN pt.kind = 'bigwin' OR (pt.kind = 'rain' AND re.kind = 'bigwin') THEN 'bigwin'
             WHEN pt.kind = 'maxwin' OR (pt.kind = 'rain' AND re.kind = 'maxwin') THEN 'maxwin'
             WHEN pt.kind = 'rain' THEN 'rain'
             WHEN pt.kind = 'prediction' THEN 'prediction'
             WHEN pt.kind = 'daily_box' THEN 'daily_box'
             WHEN pt.kind = 'leaderboard_bonus' OR pt.kind LIKE 'tiktok%' THEN 'ranking'
             WHEN pt.kind IN ('giveaway_ticket', 'giveaway_refund') THEN 'tickets'
             WHEN pt.kind = 'loot_box_open' THEN 'boxes_paid'
             WHEN pt.kind = 'loot_box_prize' THEN 'boxes_back'
             WHEN pt.kind IN ('crash_bet', 'plinko_bet', 'mines_bet', 'crash_refund', 'mines_refund') THEN 'games_bet'
             WHEN pt.kind IN ('crash_payout', 'plinko_payout', 'mines_payout') THEN 'games_back'
             WHEN pt.kind IN ('bid_hold', 'bid_refund', 'product_redeem', 'order_refund') THEN 'shop_ledger'
             WHEN pt.kind IN ('monthly_reset', 'admin_reset') OR pt.op = 'reset' THEN 'reset'
             ELSE 'other'
           END AS bucket,
           sum(pt.amount)::bigint AS points
      FROM point_transactions pt
      LEFT JOIN rain_events re
        ON pt.kind = 'rain' AND pt.ref_type = 'rain_event' AND re.id::text = pt.ref_id
     WHERE pt.created_at >= v_from
     GROUP BY 1, 2
  ),
  sold AS (
    SELECT date_trunc(v_unit, to_timestamp(o.created_at) AT TIME ZONE 'Europe/Andorra')::date AS start,
           o.id, o.user_id, o.total, o.created_at,
           COALESCE(o.currency, 'points') AS currency,
           pr.name AS product, pr.price AS start_price
      FROM orders o
      JOIN products pr ON pr.id = o.product_id
     WHERE o.created_at >= v_from AND o.status <> 2
  ),
  listed AS (
    -- Premios dados de alta en el periodo, en unidades: las que quedan más las ya vendidas.
    SELECT date_trunc(v_unit, to_timestamp(pr.created_at) AT TIME ZONE 'Europe/Andorra')::date AS start,
           count(*)::integer AS products,
           sum(GREATEST(pr.stock, 0) + (SELECT count(*) FROM orders o WHERE o.product_id = pr.id AND o.status <> 2))::integer AS units
      FROM products pr
     WHERE pr.created_at >= v_from
     GROUP BY 1
  ),
  winners AS (
    -- Personas con algún premio: pedidos de la tienda (sin cancelados) y sorteos ganados.
    SELECT start, user_id FROM sold
    UNION
    SELECT date_trunc(v_unit, to_timestamp(COALESCE(g.drawn_at, g.end_at)) AT TIME ZONE 'Europe/Andorra')::date, g.winner
      FROM giveaways g
     WHERE g.winner IS NOT NULL AND COALESCE(g.drawn_at, g.end_at) >= v_from
  )
  SELECT jsonb_agg(
           jsonb_build_object(
             'start', p.start,
             'end', (p.next_start - 1),
             'earned', jsonb_build_object(
               'watch', COALESCE((SELECT points FROM tx WHERE tx.start = p.start AND bucket = 'watch'), 0),
               'streak', COALESCE((SELECT points FROM tx WHERE tx.start = p.start AND bucket = 'streak'), 0),
               'rain', COALESCE((SELECT points FROM tx WHERE tx.start = p.start AND bucket = 'rain'), 0),
               'bigwin', COALESCE((SELECT points FROM tx WHERE tx.start = p.start AND bucket = 'bigwin'), 0),
               'maxwin', COALESCE((SELECT points FROM tx WHERE tx.start = p.start AND bucket = 'maxwin'), 0),
               'prediction', COALESCE((SELECT points FROM tx WHERE tx.start = p.start AND bucket = 'prediction'), 0),
               'daily_box', COALESCE((SELECT points FROM tx WHERE tx.start = p.start AND bucket = 'daily_box'), 0),
               'ranking', COALESCE((SELECT points FROM tx WHERE tx.start = p.start AND bucket = 'ranking'), 0)
             ),
             'spent', jsonb_build_object(
               'bids', COALESCE((SELECT sum(total) FROM sold s WHERE s.start = p.start AND s.currency = 'points'), 0),
               'tickets', -COALESCE((SELECT points FROM tx WHERE tx.start = p.start AND bucket = 'tickets'), 0),
               'boxes_paid', -COALESCE((SELECT points FROM tx WHERE tx.start = p.start AND bucket = 'boxes_paid'), 0),
               'boxes_back', COALESCE((SELECT points FROM tx WHERE tx.start = p.start AND bucket = 'boxes_back'), 0),
               'games_bet', -COALESCE((SELECT points FROM tx WHERE tx.start = p.start AND bucket = 'games_bet'), 0),
               'games_back', COALESCE((SELECT points FROM tx WHERE tx.start = p.start AND bucket = 'games_back'), 0)
             ),
             'other', COALESCE((SELECT points FROM tx WHERE tx.start = p.start AND bucket = 'other'), 0),
             'prizes', jsonb_build_object(
               'listed', COALESCE((SELECT units FROM listed l WHERE l.start = p.start), 0),
               'sold', (SELECT count(*) FROM sold s WHERE s.start = p.start),
               'start_total', COALESCE((SELECT sum(start_price) FROM sold s WHERE s.start = p.start AND s.currency = 'points'), 0),
               'final_total', COALESCE((SELECT sum(total) FROM sold s WHERE s.start = p.start AND s.currency = 'points'), 0),
               'vip_sold', (SELECT count(*) FROM sold s WHERE s.start = p.start AND s.currency = 'vip'),
               'winners', (SELECT count(DISTINCT w.user_id) FROM winners w WHERE w.start = p.start)
             )
           )
           ORDER BY p.start DESC
         )
    INTO v_periods
    FROM periods p;

  -- Premios vendidos del rango, uno a uno: precio final frente a su salida.
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.created_at DESC, x.id DESC), '[]'::jsonb)
    INTO v_sold
    FROM (
      SELECT o.id, o.created_at,
             jsonb_build_object(
               'order_id', o.id,
               'period', date_trunc(v_unit, to_timestamp(o.created_at) AT TIME ZONE 'Europe/Andorra')::date,
               'created_at', o.created_at,
               'product', pr.name,
               'currency', COALESCE(o.currency, 'points'),
               'start_price', pr.price,
               'final_price', o.total,
               'username', u.username
             ) AS j
        FROM orders o
        JOIN products pr ON pr.id = o.product_id
        LEFT JOIN users u ON u.id = o.user_id
       WHERE o.created_at >= v_from AND o.status <> 2
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT 500
    ) x;

  RETURN jsonb_build_object(
    'unit', v_unit,
    'periods', COALESCE(v_periods, '[]'::jsonb),
    'sold', v_sold
  );
END $$;

-- ───────────────────────── cuentas repetidas ─────────────────────────

-- Correo y usuario del casino del ganador y su IP, tal como estaban al crearse
-- el pedido y al entregarlo. casino_accounts: [{ "casino": …, "username": …, "status": … }].
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_email text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS casino_accounts jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS winner_ip text;

-- IP desde la que ha pujado cada usuario (la apunta la ruta de pujar del back).
CREATE TABLE IF NOT EXISTS user_ips (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ip text NOT NULL,
  first_seen integer NOT NULL,
  last_seen integer NOT NULL,
  hits integer NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, ip)
);
CREATE INDEX IF NOT EXISTS idx_user_ips_ip ON user_ips (ip);

-- Correo en forma comparable: minúsculas, sin lo que va detrás de «+» y, en
-- Gmail, sin puntos. NULL si no parece un correo.
CREATE OR REPLACE FUNCTION dup_email_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL OR lower(btrim(p)) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN NULL
    WHEN split_part(lower(btrim(p)), '@', 2) IN ('gmail.com', 'googlemail.com')
      THEN replace(split_part(split_part(lower(btrim(p)), '@', 1), '+', 1), '.', '') || '@gmail.com'
    ELSE split_part(split_part(lower(btrim(p)), '@', 1), '+', 1) || '@' || split_part(lower(btrim(p)), '@', 2)
  END
$$;

-- Usuario de casino en forma comparable: minúsculas y sin espacios.
CREATE OR REPLACE FUNCTION dup_text_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(lower(regexp_replace(COALESCE(p, ''), '\s+', '', 'g')), '')
$$;

CREATE INDEX IF NOT EXISTS idx_users_email_key ON users (dup_email_key(email));
CREATE INDEX IF NOT EXISTS idx_verification_requests_email_key
  ON verification_requests (dup_email_key(casino_username));
CREATE INDEX IF NOT EXISTS idx_verification_requests_text_key
  ON verification_requests (dup_text_key(casino_username));

-- Apunta la IP de un usuario. Ignora lo que no parezca una IP.
CREATE OR REPLACE FUNCTION user_ip_touch(p_user_id integer, p_ip text) RETURNS boolean
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_ip text := lower(btrim(COALESCE(p_ip, '')));
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  IF p_user_id IS NULL OR length(v_ip) < 3 OR length(v_ip) > 45 OR v_ip !~ '^[0-9a-f:.]+$' THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RETURN false;
  END IF;
  INSERT INTO user_ips (user_id, ip, first_seen, last_seen, hits)
  VALUES (p_user_id, v_ip, v_now, v_now, 1)
  ON CONFLICT (user_id, ip) DO UPDATE
    SET last_seen = v_now, hits = user_ips.hits + 1;
  RETURN true;
END $$;

-- Guarda en el pedido el correo de entrega, las cuentas de casino y la última IP
-- del ganador: al crearse el pedido y otra vez al marcarlo entregado (estado 1).
-- Nunca impide crear ni cambiar un pedido: si algo falla, el pedido sigue.
CREATE OR REPLACE FUNCTION orders_snapshot_winner() RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT (NEW.status = 1 AND OLD.status IS DISTINCT FROM 1) THEN
      RETURN NEW;
    END IF;
  END IF;
  BEGIN
    NEW.delivery_email := COALESCE((SELECT email FROM users WHERE id = NEW.user_id), NEW.delivery_email);
    NEW.casino_accounts := COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('casino', vr.casino, 'username', vr.casino_username, 'status', vr.status)
                        ORDER BY vr.id)
         FROM verification_requests vr
        WHERE vr.user_id = NEW.user_id AND vr.status IN ('approved', 'pending')),
      NEW.casino_accounts);
    NEW.winner_ip := COALESCE(
      (SELECT ip FROM user_ips WHERE user_id = NEW.user_id ORDER BY last_seen DESC, ip LIMIT 1),
      NEW.winner_ip);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_orders_snapshot_winner ON orders;
CREATE TRIGGER trg_orders_snapshot_winner
  BEFORE INSERT OR UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_snapshot_winner();

-- Pedidos anteriores: se rellenan con los datos de hoy.
UPDATE orders o
   SET delivery_email = u.email
  FROM users u
 WHERE u.id = o.user_id AND o.delivery_email IS NULL;
UPDATE orders o
   SET casino_accounts = x.accounts
  FROM (
    SELECT vr.user_id,
           jsonb_agg(jsonb_build_object('casino', vr.casino, 'username', vr.casino_username, 'status', vr.status)
                     ORDER BY vr.id) AS accounts
      FROM verification_requests vr
     WHERE vr.status IN ('approved', 'pending')
     GROUP BY vr.user_id
  ) x
 WHERE x.user_id = o.user_id AND o.casino_accounts IS NULL;

-- Avisos de cuentas repetidas de los pedidos indicados (o de todos, sin los
-- cancelados). Solo informan: no bloquean ninguna entrega. Cada aviso:
--   { "type": "email" | "casino" | "ip", "text": …, "users": [{ "id", "username" }] }
--   email  → el correo de entrega coincide con el correo de otra cuenta o con el
--            usuario de casino que dio otra cuenta
--   casino → un usuario de casino del ganador coincide con el de otra cuenta o
--            con el correo de otra cuenta
--   ip     → el ganador comparte IP con otra cuenta que también tiene premios
CREATE OR REPLACE FUNCTION orders_duplicate_flags(p_order_ids integer[] DEFAULT NULL)
RETURNS TABLE (order_id integer, flags jsonb)
LANGUAGE sql
STABLE
SET search_path FROM CURRENT
AS $$
  WITH o AS (
    SELECT ord.id, ord.user_id,
           dup_email_key(COALESCE(ord.delivery_email, u.email)) AS email_key
      FROM orders ord
      JOIN users u ON u.id = ord.user_id
     WHERE ord.status <> 2
       AND (p_order_ids IS NULL OR ord.id = ANY (p_order_ids))
  ),
  email_hits AS (
    SELECT o.id, u2.id AS other_id, u2.username
      FROM o
      JOIN users u2 ON dup_email_key(u2.email) = o.email_key AND u2.id <> o.user_id
     WHERE o.email_key IS NOT NULL
    UNION
    SELECT o.id, u2.id, u2.username
      FROM o
      JOIN verification_requests vr2 ON dup_email_key(vr2.casino_username) = o.email_key AND vr2.user_id <> o.user_id
      JOIN users u2 ON u2.id = vr2.user_id
     WHERE o.email_key IS NOT NULL
  ),
  casino_hits AS (
    SELECT o.id, u2.id AS other_id, u2.username
      FROM o
      JOIN verification_requests vr ON vr.user_id = o.user_id
      JOIN verification_requests vr2
        ON dup_text_key(vr2.casino_username) = dup_text_key(vr.casino_username) AND vr2.user_id <> o.user_id
      JOIN users u2 ON u2.id = vr2.user_id
    UNION
    SELECT o.id, u2.id, u2.username
      FROM o
      JOIN verification_requests vr ON vr.user_id = o.user_id
      JOIN users u2 ON dup_email_key(u2.email) = dup_email_key(vr.casino_username) AND u2.id <> o.user_id
     WHERE dup_email_key(vr.casino_username) IS NOT NULL
  ),
  ip_hits AS (
    SELECT DISTINCT o.id, u2.id AS other_id, u2.username
      FROM o
      JOIN user_ips a ON a.user_id = o.user_id
      JOIN user_ips b ON b.ip = a.ip AND b.user_id <> o.user_id
      JOIN users u2 ON u2.id = b.user_id
     WHERE EXISTS (SELECT 1 FROM orders w WHERE w.user_id = b.user_id AND w.status <> 2)
  ),
  flags AS (
    SELECT id, 1 AS pos, jsonb_build_object(
             'type', 'email',
             'text', 'El correo de entrega coincide con el de otra cuenta',
             'users', jsonb_agg(DISTINCT jsonb_build_object('id', other_id, 'username', username))) AS flag
      FROM email_hits GROUP BY id
    UNION ALL
    SELECT id, 2, jsonb_build_object(
             'type', 'casino',
             'text', 'El usuario del casino coincide con el de otra cuenta',
             'users', jsonb_agg(DISTINCT jsonb_build_object('id', other_id, 'username', username)))
      FROM casino_hits GROUP BY id
    UNION ALL
    SELECT id, 3, jsonb_build_object(
             'type', 'ip',
             'text', 'Comparte IP con otra cuenta que también tiene premios',
             'users', jsonb_agg(DISTINCT jsonb_build_object('id', other_id, 'username', username)))
      FROM ip_hits GROUP BY id
  )
  SELECT id, jsonb_agg(flag ORDER BY pos) FROM flags GROUP BY id
$$;

-- ───────────────────────── permisos ─────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'admin_stats(text, integer)',
    'user_ip_touch(integer, text)',
    'orders_duplicate_flags(integer[])'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_object THEN NULL; -- roles de Supabase ausentes
    END;
  END LOOP;
END $$;

ALTER TABLE user_ips ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  GRANT ALL ON TABLE user_ips TO service_role;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
