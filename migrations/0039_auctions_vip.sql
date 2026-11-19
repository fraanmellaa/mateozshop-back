-- 0039 · Pujas y puntos VIP: economía final (18 nov 2026)
--
-- Aplicar a mano en el SQL editor de Supabase, después de la 0036. Se puede
-- ejecutar más de una vez. No cambia la firma de ninguna función: el código
-- anterior sigue pudiendo llamarlas.
--
-- Pujas (puntos normales y VIP)
--   · Una puja solo se ABRE (primera oferta) con el directo encendido. Una ya
--     abierta termina con normalidad aunque el directo acabe.        STREAM_OFFLINE
--   · Como mucho N pujas normales abiertas a la vez (ajuste
--     `shop.maxOpenAuctions`, 3 de serie). Las VIP no cuentan.    MAX_OPEN_AUCTIONS
--   · `products.available_from`: fecha «disponible desde». Antes de esa fecha
--     el premio se ve pero no se puede pujar.                     NOT_AVAILABLE_YET
--   · El último día del mes no se abren pujas desde las 23:00 (hora de
--     Andorra), ni el día 1 hasta que termina el reinicio mensual, ni mientras
--     hay un reinicio a medias.                                       MONTH_CLOSING
--   · `products.counts_for_cap` = false: el premio no cuenta para el máximo de
--     premios al mes (ni al ganarlo ni al pujar por él).
--   · Tope de premios al mes: cuentan los ya ganados MÁS las pujas que el
--     usuario va ganando ahora mismo en otros premios.
--   · Reinicio mensual: los puntos retenidos en una puja no lo sobreviven. El
--     reinicio de saldos se niega a empezar si queda alguna puja con puntos
--     retenidos, y una devolución de puntos retenidos antes de un reinicio ya
--     no suma nada (auction_hold_voided).
--
-- Puntos VIP
--   · Cada premio VIP se abre en su propia fecha (`available_from`), ya no en
--     la fecha única `shop.vipOpensAt`. Sin fecha, está cerrado. Solo se puede
--     abrir durante el primer directo que haya desde esa fecha y dentro de su
--     mes: si ese directo acaba sin pujas, el premio no se entrega y se queda
--     en la tienda hasta que se le ponga otra fecha (vip_product_state).
--   · Al aprobar una verificación, la cuenta recibe los puntos VIP de
--     bienvenida (`shop.vipWelcomePoints`, 5.000 de serie), una sola vez por
--     casino.
--   · «No se pudo comprobar la verificación del ganador» (order_pass_next): el
--     pedido se anula, los puntos VIP de su puja NO se devuelven y el premio se
--     vuelve a poner en puja (sin fecha, hasta que el admin ponga otra). Ya no
--     pasa a la siguiente puja más alta.

SET search_path TO public;

-- ───────────────────────── columnas ─────────────────────────

ALTER TABLE products ADD COLUMN IF NOT EXISTS available_from integer;            -- segundos Unix; NULL = sin fecha
ALTER TABLE products ADD COLUMN IF NOT EXISTS counts_for_cap boolean NOT NULL DEFAULT true;

-- ───────────────────────── funciones de apoyo ─────────────────────────

-- ¿Ha habido un reinicio de saldos después de retener estos puntos? Si es así,
-- esos puntos ya «murieron» con el reinicio y no se devuelven. Los VIP solo si
-- el reinicio mensual de VIP está activado (ajuste `shop.vipMonthlyReset`).
CREATE OR REPLACE FUNCTION auction_hold_voided(p_held_at integer, p_currency text) RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path FROM CURRENT
AS $$
BEGIN
  IF p_held_at IS NULL THEN
    RETURN false;
  END IF;
  IF p_currency = 'vip' AND shop_cfg('vipMonthlyReset', 1) < 1 THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM monthly_resets
     WHERE balances_reset_at IS NOT NULL AND balances_reset_at >= p_held_at
  );
END $$;

-- Motivo por el que ahora mismo no se puede ABRIR ninguna puja por el cierre
-- de mes, o NULL si se puede:
--   · último día del mes (Andorra) desde las 23:00;
--   · día 1 mientras el reinicio de ese mes no ha terminado (si el reinicio
--     automático está activado y no lleva más de 3 h atascado);
--   · cualquier reinicio a medias (también los forzados a mano), hasta 3 h.
CREATE OR REPLACE FUNCTION auction_opening_blocked(p_now integer) RETURNS text
LANGUAGE plpgsql STABLE
SET search_path FROM CURRENT
AS $$
DECLARE
  v_local timestamp := to_timestamp(p_now) AT TIME ZONE 'Europe/Andorra';
  v_next_month timestamp := date_trunc('month', to_timestamp(p_now) AT TIME ZONE 'Europe/Andorra') + interval '1 month';
  v_enabled boolean;
BEGIN
  IF v_local >= v_next_month - interval '1 hour' THEN
    RETURN 'MONTH_CLOSING';
  END IF;

  IF EXISTS (SELECT 1 FROM monthly_resets
              WHERE completed_at IS NULL AND started_at > p_now - 3 * 3600) THEN
    RETURN 'MONTH_CLOSING';
  END IF;

  IF extract(day FROM v_local) = 1
     AND NOT EXISTS (SELECT 1 FROM monthly_resets WHERE month = ad_month(p_now)) THEN
    SELECT COALESCE((value -> 'monthlyReset' ->> 'enabled')::boolean, true) INTO v_enabled
      FROM app_settings WHERE key = 'economy' LIMIT 1;
    IF COALESCE(v_enabled, true) THEN
      RETURN 'MONTH_CLOSING';
    END IF;
  END IF;

  RETURN NULL;
END $$;

-- Estado de la apertura de un premio VIP según su fecha:
--   no_date   sin fecha puesta: cerrado
--   upcoming  la fecha aún no ha llegado
--   open      la fecha ha llegado y su directo (el primero desde esa fecha) no
--             ha terminado: se puede abrir la puja si hay directo
--   missed    su directo ya pasó, o la fecha es de otro mes: cerrado hasta que
--             se le ponga otra fecha
CREATE OR REPLACE FUNCTION vip_product_state(p_available_from integer, p_now integer) RETURNS text
LANGUAGE plpgsql STABLE
SET search_path FROM CURRENT
AS $$
DECLARE
  v_first date;
BEGIN
  IF p_available_from IS NULL THEN
    RETURN 'no_date';
  END IF;
  IF p_now < p_available_from THEN
    RETURN 'upcoming';
  END IF;
  IF ad_month(p_available_from) <> ad_month(p_now) THEN
    RETURN 'missed';
  END IF;

  -- Primer día de directo desde la fecha de apertura (los directos que venían
  -- del día anterior no cuentan).
  SELECT min(day) INTO v_first
    FROM stream_sessions
   WHERE day >= ad_day(p_available_from)
     AND (ended_at IS NULL OR ended_at > p_available_from);

  IF v_first IS NULL THEN
    RETURN 'open'; -- su directo todavía no ha empezado
  END IF;
  IF EXISTS (SELECT 1 FROM stream_sessions WHERE ended_at IS NULL AND day = v_first) THEN
    RETURN 'open';
  END IF;
  -- Su directo no está en marcha: si es de un día anterior, o ya hay un directo
  -- de otro día, pasó. Un corte dentro del mismo día no lo cierra.
  IF v_first < ad_day(p_now)
     OR EXISTS (SELECT 1 FROM stream_sessions WHERE ended_at IS NULL AND day > v_first) THEN
    RETURN 'missed';
  END IF;
  RETURN 'open';
END $$;

-- Lo que la web necesita para pintar la tienda: si hay directo, cuántas pujas
-- normales hay abiertas y el máximo, si el cierre de mes bloquea las aperturas
-- y el estado de cada premio VIP.
CREATE OR REPLACE FUNCTION shop_open_state() RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  RETURN jsonb_build_object(
    'live', EXISTS (SELECT 1 FROM stream_sessions WHERE ended_at IS NULL),
    'open_auctions', (
      SELECT count(*)::integer FROM products
       WHERE is_auction AND currency <> 'vip'
         AND auction_status = 'in_progress' AND auction_ends_at > v_now),
    'max_open', GREATEST(shop_cfg('maxOpenAuctions', 3), 1)::integer,
    'month_closing', auction_opening_blocked(v_now) IS NOT NULL,
    'vip', COALESCE((
      SELECT jsonb_object_agg(id::text, vip_product_state(available_from, v_now))
        FROM products WHERE currency = 'vip'), '{}'::jsonb)
  );
END $$;

-- Premios ganados en el mes en una moneda. En puntos normales no cuentan los
-- premios marcados «no cuenta para el tope». Los VIP cuentan siempre (uno al mes).
CREATE OR REPLACE FUNCTION auction_wins_in_month(p_user_id integer, p_now integer, p_currency text)
RETURNS integer
LANGUAGE sql STABLE
SET search_path FROM CURRENT
AS $$
  SELECT count(*)::integer
    FROM orders o
    LEFT JOIN products pr ON pr.id = o.product_id
   WHERE o.user_id = p_user_id
     AND o.bid_round IS NOT NULL
     AND o.status <> 2
     AND o.currency = p_currency
     AND ad_month(o.created_at) = ad_month(p_now)
     AND (p_currency = 'vip' OR COALESCE(pr.counts_for_cap, true))
$$;

-- Ya no se usa: cada premio VIP tiene su fecha. Se mantiene para el código
-- anterior, que la consulta con la fecha única de los ajustes.
CREATE OR REPLACE FUNCTION vip_bids_open(p_now integer) RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path FROM CURRENT
AS $$
DECLARE
  v_opens bigint := shop_cfg('vipOpensAt', 0)::bigint;
BEGIN
  RETURN v_opens > 0 AND p_now >= v_opens AND ad_month(v_opens::integer) = ad_month(p_now);
END $$;

-- ───────────────────────── pujar ─────────────────────────

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
  v_max_open integer := GREATEST(shop_cfg('maxOpenAuctions', 3), 1)::integer;
  v_opening boolean;
  v_block text;
  v_vip_state text;
  v_leading integer;
  v_min bigint;
  v_next_min bigint;
  v_prev_user integer;
  v_prev_amount integer;
  v_prev_held integer;
  v_prev_voided boolean := false;
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

  v_opening := p.auction_status = 'waiting';

  -- Abrir una puja (primera oferta): fecha del premio, directo y cierre de mes.
  -- Una puja ya abierta no pasa por aquí: termina con normalidad.
  IF v_opening THEN
    IF p.currency = 'vip' THEN
      v_vip_state := vip_product_state(p.available_from, v_now);
      IF v_vip_state <> 'open' THEN
        RAISE EXCEPTION 'VIP_NOT_OPEN' USING DETAIL = v_vip_state;
      END IF;
      -- Tiene que ser un directo del día de apertura o posterior, no la cola
      -- de uno que venía de la víspera.
      IF NOT EXISTS (SELECT 1 FROM stream_sessions
                      WHERE ended_at IS NULL AND day >= ad_day(p.available_from)) THEN
        RAISE EXCEPTION 'STREAM_OFFLINE';
      END IF;
    ELSE
      IF p.available_from IS NOT NULL AND v_now < p.available_from THEN
        RAISE EXCEPTION 'NOT_AVAILABLE_YET' USING DETAIL = p.available_from::text;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM stream_sessions WHERE ended_at IS NULL) THEN
        RAISE EXCEPTION 'STREAM_OFFLINE';
      END IF;
    END IF;

    v_block := auction_opening_blocked(v_now);
    IF v_block IS NOT NULL THEN
      RAISE EXCEPTION '%', v_block;
    END IF;
  END IF;

  IF v_opening THEN
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
  -- Premio en puntos VIP: solo pujan los usuarios verificados.
  IF p.currency = 'vip' AND NOT COALESCE(u.is_verified, false) THEN
    RAISE EXCEPTION 'VERIFIED_REQUIRED';
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

  IF p.currency = 'vip' THEN
    -- Como mucho un premio VIP por persona y mes: ni ganado ya, ni liderando otro.
    IF auction_wins_in_month(p_user_id, v_now, 'vip') >= 1 THEN
      RAISE EXCEPTION 'VIP_WIN_CAP_REACHED';
    END IF;
    IF EXISTS (SELECT 1 FROM products
                WHERE currency = 'vip' AND id <> p.id
                  AND auction_status IN ('in_progress', 'finalizing')
                  AND current_bidder_user_id = p_user_id) THEN
      RAISE EXCEPTION 'VIP_ALREADY_LEADING';
    END IF;
  ELSIF p.counts_for_cap THEN
    -- Tope de premios normales al mes: los ya ganados más las pujas que va
    -- ganando ahora mismo en OTROS premios (los que no cuentan, aparte).
    SELECT count(*)::integer INTO v_leading
      FROM products
     WHERE currency <> 'vip' AND counts_for_cap AND id <> p.id
       AND auction_status IN ('in_progress', 'finalizing')
       AND current_bidder_user_id = p_user_id;
    IF auction_wins_in_month(p_user_id, v_now, 'points') + v_leading >= v_cap THEN
      RAISE EXCEPTION 'MONTHLY_WIN_CAP_REACHED' USING DETAIL = v_cap::text;
    END IF;
  END IF;

  -- Primera puja: al menos el precio de salida. Siguientes: al menos +pct % (mínimo +1).
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

  -- Máximo de pujas normales abiertas a la vez. El cerrojo hace que dos
  -- aperturas simultáneas de premios distintos se cuenten una detrás de otra.
  IF v_opening AND p.currency <> 'vip' THEN
    PERFORM pg_advisory_xact_lock(hashtext('shop:auction_open'));
    IF (SELECT count(*) FROM products
         WHERE is_auction AND currency <> 'vip' AND id <> p.id
           AND auction_status = 'in_progress' AND auction_ends_at > v_now) >= v_max_open THEN
      RAISE EXCEPTION 'MAX_OPEN_AUCTIONS' USING DETAIL = v_max_open::text;
    END IF;
  END IF;

  IF v_opening THEN
    v_ends := v_now + (v_battle * 60)::integer;
  ELSIF v_now >= p.auction_ends_at - (v_window * 60)::integer THEN
    v_ends := p.auction_ends_at + (v_extend * 60)::integer;
    v_extended := v_extend > 0;
  ELSE
    v_ends := p.auction_ends_at;
  END IF;

  -- Si los puntos del postor anterior se retuvieron antes de un reinicio de
  -- saldos, ya no existen: ni se devuelven ni descuentan de una subida propia.
  IF v_prev_user IS NOT NULL THEN
    SELECT max(created_at) INTO v_prev_held
      FROM product_bids
     WHERE product_id = p.id AND auction_round = p.auction_round AND user_id = v_prev_user;
    v_prev_voided := auction_hold_voided(v_prev_held, p.currency);
  END IF;

  INSERT INTO product_bids (product_id, user_id, amount, created_at, auction_round)
  VALUES (p.id, p_user_id, p_amount, v_now, p.auction_round)
  RETURNING id INTO v_bid_id;

  IF v_prev_user IS NOT NULL AND v_prev_user = p_user_id AND NOT v_prev_voided THEN
    -- Sube su propia puja: solo se retiene la diferencia.
    v_balance := wallet_move(p.currency, p_user_id, p_amount - v_prev_amount, 'debit', 'bid_hold', 'product', p.id::text,
                             NULL, jsonb_build_object('bid_id', v_bid_id, 'round', p.auction_round));
  ELSE
    v_balance := wallet_move(p.currency, p_user_id, p_amount, 'debit', 'bid_hold', 'product', p.id::text,
                             NULL, jsonb_build_object('bid_id', v_bid_id, 'round', p.auction_round));
    IF v_prev_user IS NOT NULL AND v_prev_user <> p_user_id AND v_prev_amount > 0 AND NOT v_prev_voided THEN
      PERFORM wallet_move(p.currency, v_prev_user, v_prev_amount, 'refund', 'bid_refund', 'product', p.id::text,
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
    'previous_amount', CASE WHEN v_prev_voided THEN 0 ELSE v_prev_amount END,
    'balance', v_balance,
    'currency', p.currency,
    'opened', v_opening
  );
END $$;

-- ───────────────────────── adjudicar ─────────────────────────

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
  v_held integer;
  v_refunded integer := 0;
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
  ELSIF p.currency = 'vip' AND auction_wins_in_month(u.id, v_now, 'vip') >= 1 THEN
    v_reason := 'MONTHLY_WIN_CAP_REACHED';
  ELSIF p.currency <> 'vip' AND p.counts_for_cap
        AND auction_wins_in_month(u.id, v_now, 'points') >= v_cap THEN
    v_reason := 'MONTHLY_WIN_CAP_REACHED';
  END IF;

  IF v_reason IS NOT NULL THEN
    -- No se adjudica: se devuelve la retención (clave idempotente) y la puja
    -- vuelve a esperar. Si esos puntos se retuvieron antes de un reinicio de
    -- saldos, ya no existen y no se devuelven.
    IF v_user_found THEN
      SELECT max(created_at) INTO v_held
        FROM product_bids
       WHERE product_id = p.id AND auction_round = p.auction_round AND user_id = u.id;
      IF NOT auction_hold_voided(v_held, p.currency) THEN
        PERFORM wallet_move(p.currency, u.id, p.current_bid, 'refund', 'bid_refund', 'product', p.id::text,
                            'auction:' || p.id || ':' || p.auction_round || ':release',
                            jsonb_build_object('reason', v_reason, 'round', p.auction_round));
        v_refunded := p.current_bid;
      END IF;
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
      'user_id', p.current_bidder_user_id, 'amount', v_refunded
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

-- Devuelve la retención del mejor postor (al borrar un premio desde el panel).
CREATE OR REPLACE FUNCTION auction_release_hold(p_product_id integer) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  p products%ROWTYPE;
  v_held integer;
  v_released integer := 0;
BEGIN
  SELECT * INTO p FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('released', 0, 'user_id', NULL);
  END IF;
  IF p.auction_prize_assigned OR p.current_bidder_user_id IS NULL OR COALESCE(p.current_bid, 0) <= 0 THEN
    RETURN jsonb_build_object('released', 0, 'user_id', NULL);
  END IF;

  SELECT max(created_at) INTO v_held
    FROM product_bids
   WHERE product_id = p.id AND auction_round = p.auction_round AND user_id = p.current_bidder_user_id;
  IF NOT auction_hold_voided(v_held, p.currency) THEN
    PERFORM wallet_move(p.currency, p.current_bidder_user_id, p.current_bid, 'refund', 'bid_refund', 'product', p.id::text,
                        NULL, jsonb_build_object('reason', 'auction_released', 'round', p.auction_round));
    v_released := p.current_bid;
  END IF;

  UPDATE products SET current_bid = 0, current_bidder_user_id = NULL WHERE id = p.id;

  RETURN jsonb_build_object('released', v_released, 'user_id', p.current_bidder_user_id);
END $$;

-- ───────────────────────── revisión de pedidos ─────────────────────────

-- Igual que en la 0032, salvo que al rechazar no se devuelven los puntos de un
-- pedido anterior al último reinicio de saldos (`refunded` lo dice).
CREATE OR REPLACE FUNCTION order_review(p_order_id integer, p_approve boolean, p_admin text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  o orders%ROWTYPE;
  v_refunded boolean := false;
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

  IF o.total > 0 AND NOT auction_hold_voided(o.created_at, o.currency) THEN
    PERFORM wallet_move(o.currency, o.user_id, o.total, 'refund', 'order_refund', 'order', o.id::text,
                        'order:' || o.id || ':refund');
    v_refunded := true;
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

  RETURN jsonb_build_object('action', 'rejected', 'order_id', o.id, 'user_id', o.user_id,
                            'refunded', v_refunded);
END $$;

-- El ganador de un premio VIP no acredita su registro: se anula su pedido, los
-- puntos VIP de su puja NO se devuelven y el premio se vuelve a poner en puja
-- (sin fecha de apertura: el admin pone la nueva en el panel). Conserva el
-- nombre y la firma de la 0035, pero ya no pasa el premio a la siguiente puja.
CREATE OR REPLACE FUNCTION order_pass_next(p_order_id integer, p_admin text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  o orders%ROWTYPE;
  p products%ROWTYPE;
  v_code text := NULL;
  v_reopened boolean := false;
  v_now integer := extract(epoch FROM now())::integer;
  v_note text := COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''),
                          'No se pudo comprobar la verificación: el premio se vuelve a poner en puja');
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

  -- Mismo orden de bloqueo que order_review: pedido y después producto.
  SELECT * INTO p FROM products WHERE id = o.product_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('action', 'none', 'reason', 'product_missing');
  END IF;

  -- El pedido queda anulado. Sus puntos VIP no se devuelven.
  IF o.delivered_code IS NOT NULL AND o.code_email_sent IS NOT TRUE THEN
    v_code := o.delivered_code; -- el código reservado vuelve al almacén
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

  IF v_code IS NOT NULL THEN
    UPDATE products
       SET codes = to_jsonb(v_code) || COALESCE(codes, '[]'::jsonb),
           used_codes = COALESCE(used_codes, '[]'::jsonb) - v_code
     WHERE id = p.id;
  END IF;

  -- El premio vuelve a la tienda, cerrado hasta que se le ponga otra fecha.
  IF p.auction_status = 'archived' AND p.auction_round = o.bid_round THEN
    UPDATE products
       SET stock = stock + 1,
           auction_status = 'waiting',
           auction_ends_at = NULL,
           auction_reopens_at = NULL,
           current_bid = 0,
           current_bidder_user_id = NULL,
           auction_prize_assigned = false,
           auction_round = auction_round + 1,
           available_from = NULL
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
    'reopened', v_reopened,
    'refunded', false
  );
END $$;

-- ───────────────────────── verificación: puntos de bienvenida ─────────────────────────

-- Igual que en la 0032 y, al aprobar, la cuenta recibe los puntos VIP de
-- bienvenida (`shop.vipWelcomePoints`): una sola vez por casino, aunque la
-- verificación se retire y se vuelva a aprobar.
CREATE OR REPLACE FUNCTION verification_review(p_request_id bigint, p_approve boolean, p_admin text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r verification_requests%ROWTYPE;
  v_casinos integer;
  v_welcome integer := GREATEST(shop_cfg('vipWelcomePoints', 5000), 0)::integer;
  v_key text;
  v_granted integer := 0;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  SELECT * INTO r FROM verification_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
  END IF;
  IF r.status <> 'pending' THEN
    RETURN jsonb_build_object('action', 'none', 'status', r.status, 'user_id', r.user_id);
  END IF;

  PERFORM 1 FROM users WHERE id = r.user_id FOR UPDATE;

  UPDATE verification_requests
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         note = NULLIF(btrim(COALESCE(p_note, '')), ''),
         reviewed_at = v_now,
         reviewed_by = p_admin
   WHERE id = r.id;

  IF p_approve THEN
    v_casinos := verification_recount(r.user_id);

    v_key := 'vip_welcome:' || r.user_id || ':' || lower(btrim(r.casino));
    IF v_welcome > 0 AND NOT EXISTS (SELECT 1 FROM vip_transactions WHERE idempotency_key = v_key) THEN
      PERFORM vip_move(r.user_id, v_welcome, 'credit', 'verification_welcome', 'verification_request', r.id::text,
                       v_key, jsonb_build_object('casino', r.casino));
      v_granted := v_welcome;
    END IF;
  END IF;

  RETURN jsonb_build_object('action', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
                            'user_id', r.user_id, 'casinos', v_casinos, 'welcome_points', v_granted);
END $$;

-- ───────────────────────── reinicio mensual ─────────────────────────

-- Igual que en la 0021, con una condición previa: no puede quedar ninguna puja
-- con puntos retenidos (el reinicio las cierra antes; si alguna sigue abierta,
-- falla con AUCTIONS_STILL_OPEN y se reintenta en la siguiente ejecución).
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
  IF EXISTS (SELECT 1 FROM products
              WHERE is_auction
                AND auction_status IN ('in_progress', 'finalizing')
                AND current_bidder_user_id IS NOT NULL
                AND COALESCE(current_bid, 0) > 0) THEN
    RAISE EXCEPTION 'AUCTIONS_STILL_OPEN';
  END IF;

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

-- ───────────────────────── permisos ─────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'auction_hold_voided(integer, text)',
    'auction_opening_blocked(integer)',
    'vip_product_state(integer, integer)',
    'shop_open_state()',
    'auction_wins_in_month(integer, integer, text)',
    'vip_bids_open(integer)',
    'place_bid(integer, integer, integer)',
    'auction_settle(integer, boolean)',
    'auction_release_hold(integer)',
    'order_review(integer, boolean, text, text)',
    'order_pass_next(integer, text, text)',
    'verification_review(bigint, boolean, text, text)',
    'economy_reset_balances(text, integer)'
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
