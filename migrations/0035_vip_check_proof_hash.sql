-- 0035 · Comprobación de los premios VIP y huella de las capturas
--
-- 1. Huella (SHA-256) de las dos capturas de cada solicitud de verificación.
--    Se guarda al recibir la solicitud y se conserva aunque la captura se
--    borre: sirve para avisar en el panel si otra cuenta sube la misma imagen.
--
-- 2. Al cerrarse una puja VIP el pedido queda «pendiente de comprobar»
--    (needs_review), igual que los premios caros: no se entrega hasta que el
--    admin lo confirma. auction_settle es la misma función de la 0032 con ese
--    único cambio.
--
-- 3. order_pass_next: «Pasar al siguiente». Anula el pedido VIP pendiente,
--    devuelve sus puntos VIP al ganador y adjudica el premio a la siguiente
--    puja más alta de esa misma ronda (de otro usuario que siga verificado, no
--    esté baneado, no haya ganado ya un premio VIP este mes y no vaya ganando
--    otra puja VIP). A esa persona se le cobra su puja; si su saldo VIP es
--    menor (por ejemplo, tras el reinicio del día 1) se le cobra lo que tenga.
--    El pedido nuevo queda también pendiente de comprobar. Si no queda nadie,
--    el premio se vuelve a poner en puja.
--
-- Se puede ejecutar más de una vez. Requiere la 0032.

SET search_path = public;

-- ───────────────────── 1. huella de las capturas ─────────────────────

ALTER TABLE verification_requests ADD COLUMN IF NOT EXISTS welcome_hash text;
ALTER TABLE verification_requests ADD COLUMN IF NOT EXISTS deposit_hash text;
CREATE INDEX IF NOT EXISTS idx_verification_requests_welcome_hash
  ON verification_requests (welcome_hash) WHERE welcome_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_verification_requests_deposit_hash
  ON verification_requests (deposit_hash) WHERE deposit_hash IS NOT NULL;

-- ───────────────────── 2. puja VIP: pendiente de comprobar ─────────────────────

-- Hasta ahora solo podía haber un pedido por premio y ronda. Al pasar el premio
-- al siguiente hay dos: el anulado y el nuevo. El tope sigue valiendo para los
-- pedidos vivos (nunca dos ganadores a la vez).
DROP INDEX IF EXISTS uq_orders_auction_round;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_auction_round
  ON orders (product_id, bid_round) WHERE bid_round IS NOT NULL AND status <> 2;

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
  ELSIF auction_wins_in_month(u.id, v_now, p.currency) >= (CASE WHEN p.currency = 'vip' THEN 1 ELSE v_cap END) THEN
    v_reason := 'MONTHLY_WIN_CAP_REACHED';
  END IF;

  IF v_reason IS NOT NULL THEN
    -- No se adjudica: se devuelve la retención (clave idempotente) y la
    -- subasta vuelve a esperar pujas.
    IF v_user_found THEN
      PERFORM wallet_move(p.currency, u.id, p.current_bid, 'refund', 'bid_refund', 'product', p.id::text,
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
  -- Un premio VIP queda siempre pendiente de comprobar: no se entrega hasta
  -- que el admin confirma la verificación del ganador.
  v_needs_review := COALESCE(p.value_eur, 0) > v_review_eur OR p.currency = 'vip';

  -- El código se reserva ya (sale de `codes`); si hay revisión, no se envía
  -- hasta que el admin la apruebe.
  IF p.delivery_type = 'code' AND jsonb_array_length(v_codes) > 0 THEN
    v_code := v_codes ->> 0;
    v_codes := v_codes - 0;
    v_used := v_used || to_jsonb(v_code);
  END IF;

  v_status := CASE WHEN v_code IS NOT NULL AND NOT v_needs_review THEN 1 ELSE 0 END;

  INSERT INTO orders (user_id, product_id, status, total, created_at, delivered_code, needs_review, bid_round, currency)
  VALUES (u.id, p.id, v_status, p.current_bid, v_now, v_code, v_needs_review, p.auction_round, p.currency)
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
    'round', p.auction_round,
    'currency', p.currency
  );
END $$;

-- ───────────────────── 3. pasar al siguiente ─────────────────────

CREATE OR REPLACE FUNCTION order_pass_next(p_order_id integer, p_admin text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  o orders%ROWTYPE;
  p products%ROWTYPE;
  u users%ROWTYPE;
  c record;
  v_code text := NULL;
  v_charge integer;
  v_new_order integer;
  v_reopened boolean := false;
  v_now integer := extract(epoch FROM now())::integer;
  v_note text := COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''),
                          'No se pudo comprobar la verificación: el premio pasa a la siguiente puja');
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  IF o.status = 2 THEN
    RETURN jsonb_build_object('action', 'none', 'reason', 'cancelled');
  END IF;
  IF o.currency IS DISTINCT FROM 'vip' OR o.bid_round IS NULL THEN
    RETURN jsonb_build_object('action', 'none', 'reason', 'not_vip');
  END IF;
  IF NOT o.needs_review THEN
    RETURN jsonb_build_object('action', 'none', 'reason', 'no_review');
  END IF;
  IF o.reviewed_at IS NOT NULL THEN
    RETURN jsonb_build_object('action', 'none', 'reason', 'already_reviewed');
  END IF;

  -- Mismo orden de bloqueo que order_review: pedido, producto y después usuarios.
  SELECT * INTO p FROM products WHERE id = o.product_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('action', 'none', 'reason', 'product_missing');
  END IF;

  -- El ganador anterior recupera sus puntos VIP y su pedido queda anulado.
  IF o.total > 0 AND EXISTS (SELECT 1 FROM users WHERE id = o.user_id) THEN
    PERFORM wallet_move('vip', o.user_id, o.total, 'refund', 'order_refund', 'order', o.id::text,
                        'order:' || o.id || ':refund');
  END IF;
  IF o.delivered_code IS NOT NULL AND o.code_email_sent IS NOT TRUE THEN
    v_code := o.delivered_code; -- el código reservado pasa al pedido nuevo
  END IF;
  UPDATE orders
     SET status = 2,
         reviewed_at = v_now,
         reviewed_by = p_admin,
         review_note = v_note,
         delivered_code = CASE WHEN v_code IS NOT NULL THEN NULL ELSE delivered_code END
   WHERE id = o.id;
  UPDATE product_bids SET status = 'cancelled'
   WHERE product_id = o.product_id AND auction_round = o.bid_round AND user_id = o.user_id;

  -- Siguiente puja más alta de la ronda: la mejor de cada usuario, de mayor a
  -- menor (a igual importe, quien pujó antes).
  FOR c IN
    SELECT b.user_id, max(b.amount) AS amount
      FROM product_bids b
     WHERE b.product_id = o.product_id AND b.auction_round = o.bid_round AND b.status = 'outbid'
     GROUP BY b.user_id
     ORDER BY max(b.amount) DESC, min(b.created_at) ASC, b.user_id ASC
  LOOP
    SELECT * INTO u FROM users WHERE id = c.user_id;
    CONTINUE WHEN NOT FOUND;
    CONTINUE WHEN COALESCE(u.is_banned, false) OR NOT COALESCE(u.is_verified, false);
    CONTINUE WHEN auction_wins_in_month(u.id, v_now, 'vip') >= 1;
    CONTINUE WHEN EXISTS (SELECT 1 FROM products
                           WHERE currency = 'vip'
                             AND auction_status IN ('in_progress', 'finalizing')
                             AND current_bidder_user_id = u.id);

    v_charge := LEAST(GREATEST(COALESCE(u.vip_points, 0), 0), c.amount);
    IF v_charge > 0 THEN
      PERFORM wallet_move('vip', u.id, v_charge, 'debit', 'bid_hold', 'product', o.product_id::text,
                          'order:' || o.id || ':next',
                          jsonb_build_object('passed_from_order', o.id, 'round', o.bid_round, 'bid', c.amount));
    END IF;

    INSERT INTO orders (user_id, product_id, status, total, created_at, delivered_code, needs_review, bid_round, currency)
    VALUES (u.id, o.product_id, 0, v_charge, v_now, v_code, true, o.bid_round, 'vip')
    RETURNING id INTO v_new_order;

    UPDATE product_bids SET status = 'won'
     WHERE product_id = o.product_id AND auction_round = o.bid_round
       AND user_id = u.id AND amount = c.amount;

    -- Si el premio sigue archivado con el ganador a la vista, se enseña el nuevo.
    IF p.auction_status = 'archived' AND p.auction_round = o.bid_round THEN
      UPDATE products SET current_bid = c.amount, current_bidder_user_id = u.id WHERE id = p.id;
    END IF;

    RETURN jsonb_build_object(
      'action', 'passed',
      'order_id', o.id,
      'previous_user_id', o.user_id,
      'new_order_id', v_new_order,
      'user_id', u.id,
      'amount', c.amount,
      'charged', v_charge,
      'product_id', o.product_id
    );
  END LOOP;

  -- No queda nadie a quien adjudicarlo: el premio se vuelve a poner en puja.
  IF v_code IS NOT NULL THEN
    UPDATE products
       SET codes = to_jsonb(v_code) || COALESCE(codes, '[]'::jsonb),
           used_codes = COALESCE(used_codes, '[]'::jsonb) - v_code
     WHERE id = p.id;
  END IF;
  IF p.auction_status = 'archived' AND p.auction_round = o.bid_round THEN
    UPDATE products
       SET stock = stock + 1,
           auction_status = 'waiting',
           auction_ends_at = NULL,
           auction_reopens_at = NULL,
           current_bid = 0,
           current_bidder_user_id = NULL,
           auction_prize_assigned = false,
           auction_round = auction_round + 1
     WHERE id = p.id;
    v_reopened := true;
  ELSE
    UPDATE products SET stock = stock + 1 WHERE id = p.id;
  END IF;

  RETURN jsonb_build_object(
    'action', 'reopened',
    'order_id', o.id,
    'previous_user_id', o.user_id,
    'product_id', o.product_id,
    'reopened', v_reopened
  );
END $$;

-- ───────────────────── permisos ─────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'auction_settle(integer, boolean)',
    'order_pass_next(integer, text, text)'
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
