-- 0023: tienda solo por pujas (encargo del 14 nov 2026).
--
-- Aplicar a mano en el SQL editor de Supabase DESPUÉS de la 0012, 0013 y 0019.
-- Es idempotente.
--
-- Reglas (cifras en app_settings clave `shop`, con estos defaults si falta):
--   battleMinutes 30, extendWindowMinutes 2, extendMinutes 2, minIncrementPct 5,
--   maxWinsPerMonth 3, minAccountAgeDays 30, reviewThresholdEur 25.
--
-- Estados de products.auction_status:
--   waiting      nadie ha pujado; sin fecha de cierre
--   in_progress  batalla abierta (auction_ends_at fijado por la primera puja)
--   archived     sin stock: última unidad adjudicada
--   finalizing / cancelling   transitorios (cancelling = el admin congela la puja)
-- La adjudicación vive en auction_settle (una transacción: pedido, retención,
-- stock y siguiente unidad). La fila del producto se reutiliza: la siguiente
-- unidad vuelve a `waiting` con stock-1 y auction_round+1.

SET search_path TO public;

-- ───────────────────────── products ─────────────────────────

ALTER TABLE products ADD COLUMN IF NOT EXISTS value_eur numeric(10, 2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS requires_trade_link boolean NOT NULL DEFAULT false;

-- delivery_type: code (código por email) | trade (skin por enlace de Steam) | dm (mensaje privado).
-- Los productos anteriores sin código pasan a `dm` (entrega manual), una sola vez.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'products' AND column_name = 'delivery_type'
  ) THEN
    ALTER TABLE products ADD COLUMN delivery_type text NOT NULL DEFAULT 'code';
    UPDATE products SET delivery_type = 'dm' WHERE NOT COALESCE(sendable, false);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_delivery_type_valid
    CHECK (delivery_type IN ('code', 'trade', 'dm'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Todo producto es una subasta y nace esperando pujas.
ALTER TABLE products ALTER COLUMN is_auction SET DEFAULT true;
ALTER TABLE products ALTER COLUMN auction_status SET DEFAULT 'waiting';
UPDATE products SET is_auction = true WHERE NOT is_auction;

-- Filas sin pujas que estaban abiertas o en cooldown: pasan a esperar.
UPDATE products
   SET auction_status = 'waiting',
       auction_ends_at = NULL,
       auction_reopens_at = NULL,
       current_bid = 0,
       current_bidder_user_id = NULL,
       auction_prize_assigned = false
 WHERE auction_status IN ('in_progress', 'finalized')
   AND current_bidder_user_id IS NULL
   AND stock > 0;

-- Las que quedaron cerradas sin stock se archivan.
UPDATE products SET auction_status = 'archived' WHERE auction_status = 'finalized' AND stock <= 0;

-- ───────────────────────── orders ─────────────────────────

ALTER TABLE orders ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reviewed_at integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS review_note text;
-- Ronda de subasta que originó el pedido (NULL = pedido anterior a la 0023).
-- El índice único hace imposible dos pedidos por la misma ronda.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bid_round integer;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_auction_round
  ON orders (product_id, bid_round) WHERE bid_round IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_user_won
  ON orders (user_id) WHERE bid_round IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_review_pending
  ON orders (needs_review) WHERE needs_review AND reviewed_at IS NULL;

-- ───────────────────────── ayudantes ─────────────────────────

-- Ajuste numérico de la clave `shop`; el default si falta o no es un número.
CREATE OR REPLACE FUNCTION shop_cfg(p_key text, p_default numeric) RETURNS numeric
LANGUAGE plpgsql STABLE
SET search_path FROM CURRENT
AS $$
DECLARE
  v numeric;
BEGIN
  SELECT (value ->> p_key)::numeric INTO v FROM app_settings WHERE key = 'shop';
  RETURN COALESCE(v, p_default);
EXCEPTION WHEN OTHERS THEN
  RETURN p_default;
END $$;

-- Premios ganados por subasta (no cancelados) en el mes de Andorra de p_now.
CREATE OR REPLACE FUNCTION auction_wins_in_month(p_user_id integer, p_now integer) RETURNS integer
LANGUAGE sql STABLE
SET search_path FROM CURRENT
AS $$
  SELECT count(*)::integer
    FROM orders
   WHERE user_id = p_user_id
     AND bid_round IS NOT NULL
     AND status <> 2
     AND ad_month(created_at) = ad_month(p_now)
$$;

-- ───────────────────── place_bid (reglas nuevas) ─────────────────────
-- Misma firma que la 0012. BID_TOO_LOW lleva la puja mínima en DETAIL;
-- ACCOUNT_TOO_NEW los días mínimos; MONTHLY_WIN_CAP_REACHED el tope.

CREATE OR REPLACE FUNCTION place_bid(p_user_id integer, p_product_id integer, p_amount integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  p products%ROWTYPE;
  u users%ROWTYPE;
  v_pct numeric := GREATEST(shop_cfg('minIncrementPct', 5), 0);
  v_battle numeric := GREATEST(shop_cfg('battleMinutes', 30), 1);
  v_window numeric := GREATEST(shop_cfg('extendWindowMinutes', 2), 0);
  v_extend numeric := GREATEST(shop_cfg('extendMinutes', 2), 0);
  v_min_age numeric := GREATEST(shop_cfg('minAccountAgeDays', 30), 0);
  v_cap integer := GREATEST(shop_cfg('maxWinsPerMonth', 3), 1)::integer;
  v_min bigint;
  v_next_min bigint;
  v_prev_user integer;
  v_prev_amount integer;
  v_ends integer;
  v_extended boolean := false;
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
  IF p.auction_status NOT IN ('waiting', 'in_progress') THEN
    RAISE EXCEPTION 'AUCTION_NOT_ACTIVE';
  END IF;
  IF p.stock <= 0 THEN
    RAISE EXCEPTION 'OUT_OF_STOCK';
  END IF;
  IF p.auction_status = 'in_progress' THEN
    IF p.auction_ends_at IS NULL THEN
      RAISE EXCEPTION 'AUCTION_MISSING_END_DATE';
    END IF;
    IF v_now >= p.auction_ends_at THEN
      RAISE EXCEPTION 'AUCTION_ENDED';
    END IF;
  END IF;

  IF p.auction_status = 'waiting' THEN
    v_prev_user := NULL;
    v_prev_amount := 0;
  ELSE
    v_prev_user := p.current_bidder_user_id;
    v_prev_amount := CASE WHEN v_prev_user IS NULL THEN 0 ELSE COALESCE(p.current_bid, 0) END;
  END IF;

  -- Bloquea pujador y postor anterior siempre por id creciente: dos pujas
  -- cruzadas (A en P, B en Q) no pueden esperarse entre sí.
  PERFORM 1 FROM users
    WHERE id IN (p_user_id, v_prev_user)
    ORDER BY id
    FOR UPDATE;

  SELECT * INTO u FROM users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  IF COALESCE(u.is_banned, false) THEN
    RAISE EXCEPTION 'USER_BANNED';
  END IF;
  IF u.adult_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'ADULT_REQUIRED';
  END IF;
  IF u.kick_id IS NULL AND u.twitch_id IS NULL THEN
    RAISE EXCEPTION 'USER_ACCOUNT_NOT_LINKED';
  END IF;
  -- Twitch: fecha de creación; Kick no la expone, se usa la de vinculación.
  IF NOT (
    (u.twitch_created_at IS NOT NULL AND u.twitch_created_at <= v_now - v_min_age * 86400)
    OR (u.kick_linked_at IS NOT NULL AND u.kick_linked_at <= v_now - v_min_age * 86400)
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_TOO_NEW' USING DETAIL = v_min_age::integer::text;
  END IF;
  IF p.requires_trade_link AND COALESCE(btrim(u.steam_trade_url), '') = '' THEN
    RAISE EXCEPTION 'TRADE_LINK_REQUIRED';
  END IF;
  IF auction_wins_in_month(p_user_id, v_now) >= v_cap THEN
    RAISE EXCEPTION 'MONTHLY_WIN_CAP_REACHED' USING DETAIL = v_cap::text;
  END IF;

  -- Primera puja: al menos la mínima. Siguientes: al menos +pct % (mínimo +1).
  IF v_prev_user IS NULL THEN
    v_min := GREATEST(p.price, 1);
  ELSE
    v_min := GREATEST(
      p.price::bigint,
      v_prev_amount::bigint + GREATEST(ceil(v_prev_amount * v_pct / 100.0)::bigint, 1)
    );
  END IF;
  IF p_amount < v_min THEN
    RAISE EXCEPTION 'BID_TOO_LOW' USING DETAIL = v_min::text;
  END IF;

  IF p.auction_status = 'waiting' THEN
    v_ends := v_now + (v_battle * 60)::integer;
  ELSIF v_now >= p.auction_ends_at - (v_window * 60)::integer THEN
    v_ends := p.auction_ends_at + (v_extend * 60)::integer;
    v_extended := v_extend > 0;
  ELSE
    v_ends := p.auction_ends_at;
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
     SET current_bid = p_amount,
         current_bidder_user_id = p_user_id,
         auction_status = 'in_progress',
         auction_ends_at = v_ends,
         auction_prize_assigned = false
   WHERE id = p.id;

  v_next_min := GREATEST(p.price::bigint, p_amount::bigint + GREATEST(ceil(p_amount * v_pct / 100.0)::bigint, 1));

  RETURN jsonb_build_object(
    'bid_id', v_bid_id,
    'product_id', p.id,
    'amount', p_amount,
    'created_at', v_now,
    'auction_round', p.auction_round,
    'min_bid_increment', p.min_bid_increment,
    'auction_status', 'in_progress',
    'auction_ends_at', v_ends,
    'extended', v_extended,
    'min_next_bid', v_next_min,
    'previous_bidder_user_id', CASE WHEN v_prev_user = p_user_id THEN NULL ELSE v_prev_user END,
    'previous_amount', v_prev_amount,
    'balance', v_balance
  );
END $$;

-- ───────────────────── adjudicación (atómica e idempotente) ─────────────────────
-- Una sola transacción bajo el bloqueo de la fila del producto: o se hace todo
-- (pedido, estados de las pujas, stock, siguiente unidad) o nada. Dos ejecuciones
-- a la vez se serializan por el bloqueo y la segunda ve el estado ya cambiado
-- (`none`). Los puntos del ganador ya están retenidos desde que pujó: adjudicar
-- no los mueve. El ganador se bloquea ANTES de contar sus premios del mes, así
-- dos adjudicaciones simultáneas del mismo usuario no pueden pasarse del tope.
--
-- p_force = true adjudica sin esperar a auction_ends_at (cierre mensual).
-- Devuelve action: none | reset | released | awarded.

CREATE OR REPLACE FUNCTION auction_settle(p_product_id integer, p_force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  p products%ROWTYPE;
  u users%ROWTYPE;
  v_cap integer := GREATEST(shop_cfg('maxWinsPerMonth', 3), 1)::integer;
  v_review_eur numeric := shop_cfg('reviewThresholdEur', 25);
  v_codes jsonb;
  v_used jsonb;
  v_code text := NULL;
  v_needs_review boolean;
  v_order_id integer;
  v_status integer;
  v_stock_after integer;
  v_reason text := NULL;
  v_had_bids boolean;
  v_user_found boolean;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  SELECT * INTO p FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND OR NOT p.is_auction THEN
    RETURN jsonb_build_object('action', 'none');
  END IF;
  IF p.auction_status NOT IN ('in_progress', 'finalizing') THEN
    RETURN jsonb_build_object('action', 'none');
  END IF;
  IF p.auction_status = 'in_progress' AND NOT p_force
     AND p.auction_ends_at IS NOT NULL AND p.auction_ends_at > v_now THEN
    RETURN jsonb_build_object('action', 'none');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM product_bids WHERE product_id = p.id AND auction_round = p.auction_round
  ) INTO v_had_bids;

  -- Nadie lidera la puja (el admin devolvió la retención, o no hay pujas).
  IF p.current_bidder_user_id IS NULL OR COALESCE(p.current_bid, 0) <= 0 THEN
    IF v_had_bids THEN
      UPDATE product_bids SET status = 'cancelled'
       WHERE product_id = p.id AND auction_round = p.auction_round;
    END IF;
    UPDATE products
       SET auction_status = CASE WHEN stock > 0 THEN 'waiting' ELSE 'archived' END,
           auction_ends_at = NULL,
           auction_reopens_at = NULL,
           current_bid = 0,
           current_bidder_user_id = NULL,
           auction_prize_assigned = false,
           auction_round = CASE WHEN v_had_bids THEN auction_round + 1 ELSE auction_round END
     WHERE id = p.id;
    RETURN jsonb_build_object('action', 'reset', 'product_id', p.id);
  END IF;

  -- Bloquea al ganador antes de contar sus premios del mes.
  SELECT * INTO u FROM users WHERE id = p.current_bidder_user_id FOR UPDATE;
  v_user_found := FOUND;

  IF NOT v_user_found THEN
    v_reason := 'USER_NOT_FOUND';
  ELSIF COALESCE(u.is_banned, false) THEN
    v_reason := 'USER_BANNED';
  ELSIF p.stock <= 0 THEN
    v_reason := 'OUT_OF_STOCK';
  ELSIF auction_wins_in_month(u.id, v_now) >= v_cap THEN
    v_reason := 'MONTHLY_WIN_CAP_REACHED';
  END IF;

  IF v_reason IS NOT NULL THEN
    -- No se adjudica: se devuelve la retención (clave idempotente) y la
    -- subasta vuelve a esperar pujas.
    IF v_user_found THEN
      PERFORM points_move(u.id, p.current_bid, 'refund', 'bid_refund', 'product', p.id::text,
                          'auction:' || p.id || ':' || p.auction_round || ':release',
                          jsonb_build_object('reason', v_reason, 'round', p.auction_round));
    END IF;
    UPDATE product_bids SET status = 'cancelled'
     WHERE product_id = p.id AND auction_round = p.auction_round;
    UPDATE products
       SET auction_status = CASE WHEN stock > 0 THEN 'waiting' ELSE 'archived' END,
           auction_ends_at = NULL,
           auction_reopens_at = NULL,
           current_bid = 0,
           current_bidder_user_id = NULL,
           auction_prize_assigned = false,
           auction_round = auction_round + 1
     WHERE id = p.id;
    RETURN jsonb_build_object(
      'action', 'released', 'reason', v_reason, 'product_id', p.id,
      'user_id', p.current_bidder_user_id, 'amount', p.current_bid
    );
  END IF;

  v_codes := COALESCE(p.codes, '[]'::jsonb);
  v_used := COALESCE(p.used_codes, '[]'::jsonb);
  v_needs_review := COALESCE(p.value_eur, 0) > v_review_eur;

  -- El código se reserva ya (sale de `codes`); si hay revisión, no se envía
  -- hasta que el admin la apruebe.
  IF p.delivery_type = 'code' AND jsonb_array_length(v_codes) > 0 THEN
    v_code := v_codes ->> 0;
    v_codes := v_codes - 0;
    v_used := v_used || to_jsonb(v_code);
  END IF;

  v_status := CASE WHEN v_code IS NOT NULL AND NOT v_needs_review THEN 1 ELSE 0 END;

  INSERT INTO orders (user_id, product_id, status, total, created_at, delivered_code, needs_review, bid_round)
  VALUES (u.id, p.id, v_status, p.current_bid, v_now, v_code, v_needs_review, p.auction_round)
  RETURNING id INTO v_order_id;

  UPDATE product_bids
     SET status = CASE WHEN user_id = u.id AND amount = p.current_bid THEN 'won' ELSE 'outbid' END
   WHERE product_id = p.id AND auction_round = p.auction_round;

  v_stock_after := p.stock - 1;

  IF v_stock_after > 0 THEN
    UPDATE products
       SET stock = v_stock_after,
           codes = v_codes,
           used_codes = v_used,
           auction_status = 'waiting',
           auction_ends_at = NULL,
           auction_reopens_at = NULL,
           current_bid = 0,
           current_bidder_user_id = NULL,
           auction_prize_assigned = false,
           auction_round = auction_round + 1
     WHERE id = p.id;
  ELSE
    -- Última unidad: se archiva conservando al ganador a la vista.
    UPDATE products
       SET stock = 0,
           codes = v_codes,
           used_codes = v_used,
           auction_status = 'archived',
           auction_ends_at = NULL,
           auction_reopens_at = NULL,
           auction_prize_assigned = true
     WHERE id = p.id;
  END IF;

  RETURN jsonb_build_object(
    'action', 'awarded',
    'product_id', p.id,
    'order_id', v_order_id,
    'user_id', u.id,
    'amount', p.current_bid,
    'code', v_code,
    'needs_review', v_needs_review,
    'delivery_type', p.delivery_type,
    'stock_after', v_stock_after,
    'round', p.auction_round
  );
END $$;

-- ───────────────────── revisión manual de un pedido ─────────────────────
-- Aprobar: marca la revisión (la entrega la hace el back después). Rechazar:
-- cancela el pedido, devuelve los puntos (misma clave idempotente que la
-- cancelación del panel) y, si el código reservado no se llegó a enviar, lo
-- devuelve al almacén de códigos del producto.

CREATE OR REPLACE FUNCTION order_review(p_order_id integer, p_approve boolean, p_admin text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  o orders%ROWTYPE;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  IF o.status = 2 THEN
    RETURN jsonb_build_object('action', 'none', 'reason', 'cancelled');
  END IF;
  IF NOT o.needs_review THEN
    RETURN jsonb_build_object('action', 'none', 'reason', 'no_review');
  END IF;
  IF o.reviewed_at IS NOT NULL THEN
    RETURN jsonb_build_object('action', 'none', 'reason', 'already_reviewed');
  END IF;

  -- Mismo orden de bloqueo que place_bid y auction_settle (producto antes que
  -- usuario) para que un rechazo no choque con una puja sobre el mismo producto.
  PERFORM 1 FROM products WHERE id = o.product_id FOR UPDATE;

  IF p_approve THEN
    UPDATE orders
       SET reviewed_at = v_now, reviewed_by = p_admin, review_note = NULLIF(btrim(COALESCE(p_note, '')), '')
     WHERE id = o.id;
    RETURN jsonb_build_object('action', 'approved', 'order_id', o.id, 'user_id', o.user_id,
                              'code', o.delivered_code, 'product_id', o.product_id);
  END IF;

  IF o.total > 0 THEN
    PERFORM points_move(o.user_id, o.total, 'refund', 'order_refund', 'order', o.id::text,
                        'order:' || o.id || ':refund');
  END IF;

  IF o.delivered_code IS NOT NULL AND o.code_email_sent IS NOT TRUE THEN
    UPDATE products
       SET codes = to_jsonb(o.delivered_code) || COALESCE(codes, '[]'::jsonb),
           used_codes = COALESCE(used_codes, '[]'::jsonb) - o.delivered_code
     WHERE id = o.product_id;
  END IF;

  UPDATE orders
     SET status = 2,
         reviewed_at = v_now,
         reviewed_by = p_admin,
         review_note = NULLIF(btrim(COALESCE(p_note, '')), ''),
         delivered_code = CASE WHEN o.code_email_sent IS NOT TRUE THEN NULL ELSE delivered_code END
   WHERE id = o.id;

  RETURN jsonb_build_object('action', 'rejected', 'order_id', o.id, 'user_id', o.user_id);
END $$;

-- ───────────────────── permisos ─────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'place_bid(integer, integer, integer)',
    'auction_settle(integer, boolean)',
    'order_review(integer, boolean, text, text)',
    'shop_cfg(text, numeric)',
    'auction_wins_in_month(integer, integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_object THEN NULL; -- roles de Supabase ausentes
    END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
