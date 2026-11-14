-- 0012: libro de movimientos de puntos, operaciones atómicas, rondas de
-- minijuegos y ajustes de la aplicación.
--
-- Aplicar a mano en el SQL editor de Supabase (es idempotente: se puede
-- ejecutar más de una vez). El código del back depende de estas funciones.

SET search_path TO public;

-- ───────────────────────── users ─────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_watch_award_at integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS watch_points_day integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS watch_points_today integer NOT NULL DEFAULT 0;

-- Una cuenta de Kick solo puede estar vinculada a un usuario.
CREATE UNIQUE INDEX IF NOT EXISTS users_kick_id_unique
  ON users (kick_id) WHERE kick_id IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_points_valid
    CHECK (total_points >= 0 AND used_points >= 0 AND used_points <= total_points) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_stock_non_negative
    CHECK (stock >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Código entregado en cada pedido (lo escribe redeem_product en la misma
-- transacción que el pedido). code_email_sent: NULL = sin código, true/false =
-- resultado del último envío.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_code text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS code_email_sent boolean;

-- ───────────────────── libro de movimientos ─────────────────────

CREATE TABLE IF NOT EXISTS point_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  amount integer NOT NULL,            -- efecto sobre el saldo disponible (+/-)
  op text NOT NULL,                   -- credit | debit | refund | revoke | reset
  kind text NOT NULL,                 -- motivo: watch, mines_bet, product_redeem, ...
  ref_type text,
  ref_id text,
  idempotency_key text UNIQUE,
  meta jsonb,
  balance_after integer NOT NULL,
  created_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_point_transactions_user_created
  ON point_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_point_transactions_ref
  ON point_transactions (ref_type, ref_id);

-- ───────────────────── rondas de minijuegos ─────────────────────

CREATE TABLE IF NOT EXISTS game_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  game text NOT NULL,                 -- mines | crash | plinko
  bet integer NOT NULL,
  status text NOT NULL DEFAULT 'active', -- active | won | lost | cashed_out | abandoned
  state jsonb NOT NULL DEFAULT '{}'::jsonb, -- estado secreto del servidor
  payout integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 0, -- bloqueo optimista
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  finished_at integer
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_game_rounds_one_active
  ON game_rounds (user_id, game) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_game_rounds_user_created
  ON game_rounds (user_id, created_at DESC);

-- ───────────────────── ajustes editables por el admin ─────────────────────

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at integer NOT NULL
);

-- ───────────────────── points_move ─────────────────────
-- Única vía para cambiar el saldo de un usuario. Bloquea la fila del usuario,
-- así que todas las operaciones de un mismo usuario se serializan.
--   credit : total_points += amount            (ganar puntos)
--   debit  : used_points  += amount            (gastar; exige saldo y no baneado)
--   refund : used_points  -= amount            (devolver un gasto o retención)
--   revoke : total_points -= amount            (el admin quita puntos; exige saldo)
-- Devuelve el saldo disponible tras la operación. Si p_idempotency_key ya
-- existe no aplica nada y devuelve el saldo actual.

CREATE OR REPLACE FUNCTION points_move(
  p_user_id integer,
  p_amount integer,
  p_op text,
  p_kind text,
  p_ref_type text DEFAULT NULL,
  p_ref_id text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_meta jsonb DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_total integer;
  v_used integer;
  v_banned boolean;
  v_signed integer;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  SELECT total_points, used_points, COALESCE(is_banned, false)
    INTO v_total, v_used, v_banned
    FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM point_transactions WHERE idempotency_key = p_idempotency_key
  ) THEN
    RETURN v_total - v_used;
  END IF;

  IF p_op = 'credit' THEN
    v_total := v_total + p_amount;
    v_signed := p_amount;
  ELSIF p_op = 'debit' THEN
    IF v_banned THEN
      RAISE EXCEPTION 'USER_BANNED';
    END IF;
    IF v_total - v_used < p_amount THEN
      RAISE EXCEPTION 'INSUFFICIENT_POINTS';
    END IF;
    v_used := v_used + p_amount;
    v_signed := -p_amount;
  ELSIF p_op = 'refund' THEN
    v_signed := LEAST(p_amount, v_used);
    v_used := v_used - v_signed;
  ELSIF p_op = 'revoke' THEN
    IF v_total - v_used < p_amount THEN
      RAISE EXCEPTION 'INSUFFICIENT_POINTS';
    END IF;
    v_total := v_total - p_amount;
    v_signed := -p_amount;
  ELSE
    RAISE EXCEPTION 'INVALID_OP';
  END IF;

  UPDATE users SET total_points = v_total, used_points = v_used WHERE id = p_user_id;

  INSERT INTO point_transactions
    (user_id, amount, op, kind, ref_type, ref_id, idempotency_key, meta, balance_after, created_at)
  VALUES
    (p_user_id, v_signed, p_op, p_kind, p_ref_type, p_ref_id, p_idempotency_key, p_meta, v_total - v_used, v_now);

  RETURN v_total - v_used;
END $$;

-- El admin pone a cero el saldo de un usuario.
CREATE OR REPLACE FUNCTION points_reset(p_user_id integer) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_total integer;
  v_used integer;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  SELECT total_points, used_points INTO v_total, v_used
    FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  UPDATE users SET total_points = 0, used_points = 0 WHERE id = p_user_id;

  INSERT INTO point_transactions
    (user_id, amount, op, kind, balance_after, created_at)
  VALUES
    (p_user_id, -(v_total - v_used), 'reset', 'admin_reset', 0, v_now);

  RETURN 0;
END $$;

-- ───────────────────── puntos por ver el directo ─────────────────────
-- El servidor decide importe y cadencia con su propio reloj.

CREATE OR REPLACE FUNCTION watch_heartbeat(
  p_user_id integer,
  p_interval_seconds integer,
  p_points integer,
  p_daily_cap integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_total integer;
  v_used integer;
  v_banned boolean;
  v_last integer;
  v_day integer;
  v_today integer;
  v_now integer := extract(epoch FROM now())::integer;
  v_cur_day integer;
BEGIN
  IF p_interval_seconds IS NULL OR p_interval_seconds <= 0 OR p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'INVALID_WATCH_CONFIG';
  END IF;
  v_cur_day := v_now / 86400;

  SELECT total_points, used_points, COALESCE(is_banned, false),
         last_watch_award_at, watch_points_day, watch_points_today
    INTO v_total, v_used, v_banned, v_last, v_day, v_today
    FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  IF v_banned THEN
    RAISE EXCEPTION 'USER_BANNED';
  END IF;

  IF v_day IS DISTINCT FROM v_cur_day THEN
    v_today := 0;
  END IF;

  -- Primer latido, o vuelta tras una pausa (pestaña cerrada, canal sin
  -- directo): arranca el reloj sin premiar. Solo se premia tiempo continuado.
  IF v_last IS NULL OR v_now - v_last > p_interval_seconds * 2 THEN
    UPDATE users SET last_watch_award_at = v_now, watch_points_day = v_cur_day, watch_points_today = v_today
      WHERE id = p_user_id;
    RETURN jsonb_build_object('awarded', 0, 'balance', v_total - v_used,
                              'next_in', p_interval_seconds, 'cap_reached', false);
  END IF;

  IF v_now - v_last < p_interval_seconds THEN
    RETURN jsonb_build_object('awarded', 0, 'balance', v_total - v_used,
                              'next_in', p_interval_seconds - (v_now - v_last), 'cap_reached', false);
  END IF;

  IF p_daily_cap IS NOT NULL AND v_today + p_points > p_daily_cap THEN
    UPDATE users SET last_watch_award_at = v_now, watch_points_day = v_cur_day, watch_points_today = v_today
      WHERE id = p_user_id;
    RETURN jsonb_build_object('awarded', 0, 'balance', v_total - v_used,
                              'next_in', p_interval_seconds, 'cap_reached', true);
  END IF;

  v_total := v_total + p_points;
  UPDATE users
     SET total_points = v_total, last_watch_award_at = v_now,
         watch_points_day = v_cur_day, watch_points_today = v_today + p_points
   WHERE id = p_user_id;

  INSERT INTO point_transactions (user_id, amount, op, kind, balance_after, created_at)
  VALUES (p_user_id, p_points, 'credit', 'watch', v_total - v_used, v_now);

  RETURN jsonb_build_object('awarded', p_points, 'balance', v_total - v_used,
                            'next_in', p_interval_seconds, 'cap_reached', false);
END $$;

-- ───────────────────── canje de producto ─────────────────────

CREATE OR REPLACE FUNCTION redeem_product(p_user_id integer, p_product_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  p products%ROWTYPE;
  v_kick text;
  v_code text := NULL;
  v_codes jsonb;
  v_used_codes jsonb;
  v_order_id integer;
  v_balance integer;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  SELECT * INTO p FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;
  IF p.is_auction THEN
    RAISE EXCEPTION 'AUCTION_PRODUCT_USE_BID';
  END IF;
  IF p.stock <= 0 THEN
    RAISE EXCEPTION 'OUT_OF_STOCK';
  END IF;

  SELECT kick_id INTO v_kick FROM users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  IF v_kick IS NULL THEN
    RAISE EXCEPTION 'USER_KICK_ID_NOT_FOUND';
  END IF;

  v_codes := COALESCE(p.codes, '[]'::jsonb);
  v_used_codes := COALESCE(p.used_codes, '[]'::jsonb);
  IF p.sendable THEN
    IF jsonb_array_length(v_codes) = 0 THEN
      RAISE EXCEPTION 'NO_CODES_AVAILABLE';
    END IF;
    v_code := v_codes ->> 0;
    v_codes := v_codes - 0;
    v_used_codes := v_used_codes || to_jsonb(v_code);
  END IF;

  INSERT INTO orders (user_id, product_id, status, total, created_at, delivered_code)
  VALUES (p_user_id, p.id, CASE WHEN p.sendable THEN 1 ELSE 0 END, p.price, v_now, v_code)
  RETURNING id INTO v_order_id;

  IF p.price > 0 THEN
    v_balance := points_move(p_user_id, p.price, 'debit', 'product_redeem', 'order', v_order_id::text);
  ELSE
    IF EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND COALESCE(is_banned, false)) THEN
      RAISE EXCEPTION 'USER_BANNED';
    END IF;
    SELECT total_points - used_points INTO v_balance FROM users WHERE id = p_user_id;
  END IF;

  UPDATE products
     SET stock = stock - 1, codes = v_codes, used_codes = v_used_codes
   WHERE id = p.id;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'status', CASE WHEN p.sendable THEN 1 ELSE 0 END,
    'total', p.price,
    'created_at', v_now,
    'sendable', p.sendable,
    'code', v_code,
    'balance', v_balance
  );
END $$;

-- ───────────────────── ticket de sorteo ─────────────────────

CREATE OR REPLACE FUNCTION buy_giveaway_ticket(p_user_id integer, p_giveaway_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  g giveaways%ROWTYPE;
  v_kick text;
  v_entry_id integer;
  v_balance integer;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  SELECT * INTO g FROM giveaways WHERE id = p_giveaway_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GIVEAWAY_NOT_FOUND';
  END IF;
  IF v_now < g.start_at THEN
    RAISE EXCEPTION 'GIVEAWAY_NOT_STARTED';
  END IF;
  IF g.is_closed OR g.winner IS NOT NULL OR v_now >= g.end_at THEN
    RAISE EXCEPTION 'GIVEAWAY_CLOSED';
  END IF;

  SELECT kick_id INTO v_kick FROM users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  IF v_kick IS NULL THEN
    RAISE EXCEPTION 'USER_KICK_ID_NOT_FOUND';
  END IF;

  INSERT INTO giveaways_entries (giveaway_id, user_id)
  VALUES (g.id, p_user_id)
  RETURNING id INTO v_entry_id;

  IF g.cost > 0 THEN
    v_balance := points_move(p_user_id, g.cost, 'debit', 'giveaway_ticket', 'giveaway_entry', v_entry_id::text);
  ELSE
    IF EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND COALESCE(is_banned, false)) THEN
      RAISE EXCEPTION 'USER_BANNED';
    END IF;
    SELECT total_points - used_points INTO v_balance FROM users WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'entry_id', v_entry_id,
    'giveaway_id', g.id,
    'user_id', p_user_id,
    'balance', v_balance
  );
END $$;

-- ───────────────────── pujas con retención de puntos ─────────────────────
-- Al pujar se retienen los puntos del pujador y se devuelven al anterior.
-- BID_TOO_LOW lleva la puja mínima en DETAIL.

CREATE OR REPLACE FUNCTION place_bid(p_user_id integer, p_product_id integer, p_amount integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  p products%ROWTYPE;
  v_min integer;
  v_prev_user integer;
  v_prev_amount integer;
  v_bid_id integer;
  v_balance integer;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  SELECT * INTO p FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;
  IF NOT p.is_auction THEN
    RAISE EXCEPTION 'PRODUCT_NOT_AUCTION';
  END IF;
  IF p.auction_status <> 'in_progress' THEN
    RAISE EXCEPTION 'AUCTION_NOT_ACTIVE';
  END IF;
  IF p.auction_ends_at IS NULL THEN
    RAISE EXCEPTION 'AUCTION_MISSING_END_DATE';
  END IF;
  IF v_now > p.auction_ends_at THEN
    RAISE EXCEPTION 'AUCTION_ENDED';
  END IF;

  v_prev_user := p.current_bidder_user_id;
  v_prev_amount := COALESCE(p.current_bid, 0);

  IF v_prev_user IS NULL THEN
    v_min := GREATEST(p.price, 1);
  ELSE
    v_min := GREATEST(p.price, v_prev_amount + GREATEST(p.min_bid_increment, 1));
  END IF;
  IF p_amount < v_min THEN
    RAISE EXCEPTION 'BID_TOO_LOW' USING DETAIL = v_min::text;
  END IF;

  -- Bloquea pujador y postor anterior siempre por id creciente: dos pujas
  -- cruzadas (A en P, B en Q) no pueden esperarse entre sí.
  PERFORM 1 FROM users
    WHERE id IN (p_user_id, v_prev_user)
    ORDER BY id
    FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  INSERT INTO product_bids (product_id, user_id, amount, created_at, auction_round)
  VALUES (p.id, p_user_id, p_amount, v_now, p.auction_round)
  RETURNING id INTO v_bid_id;

  IF v_prev_user IS NOT NULL AND v_prev_user = p_user_id THEN
    -- Sube su propia puja: solo se retiene la diferencia.
    v_balance := points_move(p_user_id, p_amount - v_prev_amount, 'debit', 'bid_hold', 'product', p.id::text,
                             NULL, jsonb_build_object('bid_id', v_bid_id, 'round', p.auction_round));
  ELSE
    v_balance := points_move(p_user_id, p_amount, 'debit', 'bid_hold', 'product', p.id::text,
                             NULL, jsonb_build_object('bid_id', v_bid_id, 'round', p.auction_round));
    IF v_prev_user IS NOT NULL AND v_prev_amount > 0 THEN
      PERFORM points_move(v_prev_user, v_prev_amount, 'refund', 'bid_refund', 'product', p.id::text,
                          NULL, jsonb_build_object('outbid_by_bid_id', v_bid_id, 'round', p.auction_round));
    END IF;
  END IF;

  UPDATE products
     SET current_bid = p_amount, current_bidder_user_id = p_user_id
   WHERE id = p.id;

  RETURN jsonb_build_object(
    'bid_id', v_bid_id,
    'product_id', p.id,
    'amount', p_amount,
    'created_at', v_now,
    'auction_round', p.auction_round,
    'min_bid_increment', p.min_bid_increment,
    'auction_ends_at', p.auction_ends_at,
    'previous_bidder_user_id', CASE WHEN v_prev_user = p_user_id THEN NULL ELSE v_prev_user END,
    'previous_amount', v_prev_amount,
    'balance', v_balance
  );
END $$;

-- Devuelve la retención del mejor postor y deja la subasta sin pujador.
-- Para cuando el admin borra, cancela o reinicia una subasta sin adjudicar.
CREATE OR REPLACE FUNCTION auction_release_hold(p_product_id integer) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  p products%ROWTYPE;
BEGIN
  SELECT * INTO p FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('released', 0, 'user_id', NULL);
  END IF;
  IF p.auction_prize_assigned OR p.current_bidder_user_id IS NULL OR COALESCE(p.current_bid, 0) <= 0 THEN
    RETURN jsonb_build_object('released', 0, 'user_id', NULL);
  END IF;

  PERFORM points_move(p.current_bidder_user_id, p.current_bid, 'refund', 'bid_refund', 'product', p.id::text,
                      NULL, jsonb_build_object('reason', 'auction_released', 'round', p.auction_round));

  UPDATE products SET current_bid = 0, current_bidder_user_id = NULL WHERE id = p.id;

  RETURN jsonb_build_object('released', p.current_bid, 'user_id', p.current_bidder_user_id);
END $$;

-- ───────────────────── permisos ─────────────────────
-- Solo el service role (el back) puede ejecutar estas funciones y leer las
-- tablas. RLS activado sin políticas = acceso denegado a anon/authenticated.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'points_move(integer, integer, text, text, text, text, text, jsonb)',
    'points_reset(integer)',
    'watch_heartbeat(integer, integer, integer, integer)',
    'redeem_product(integer, integer)',
    'buy_giveaway_ticket(integer, integer)',
    'place_bid(integer, integer, integer)',
    'auction_release_hold(integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_object THEN NULL; -- roles de Supabase ausentes
    END;
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'products', 'product_bids', 'orders', 'giveaways', 'giveaways_entries',
    'user_tiktok_accounts', 'user_tiktok_videos', 'tiktok_leaderboards',
    'tiktok_leaderboard_prizes', 'tiktok_leaderboard_results',
    'point_transactions', 'game_rounds', 'app_settings'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('GRANT ALL ON TABLE %I TO service_role', t);
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

-- Recargar la caché de esquema de PostgREST para que vea las funciones nuevas.
NOTIFY pgrst, 'reload schema';
