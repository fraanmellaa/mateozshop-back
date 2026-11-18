-- 0032: puntos VIP (encargo del 17 nov 2026).
--
-- Aplicar a mano en el SQL editor de Supabase DESPUÉS de la 0023 (y de la 0031 si
-- no se había aplicado: esta migración también crea `products.category`, así
-- que basta con ejecutar esta). Es idempotente.
--
-- Qué añade:
--   · Segunda moneda, «puntos VIP», con su propio saldo (`users.vip_points`) y su
--     propio libro de movimientos (`vip_transactions`, función `vip_move`).
--   · Usuarios verificados (`users.is_verified`): los marca el admin a mano.
--     Solo ellos ganan puntos VIP y solo ellos pujan por premios en VIP.
--   · `products.currency` ('points' | 'vip'): moneda en la que se puja el premio.
--     `orders.currency` guarda en qué moneda se pagó, para devolverla bien.
--   · Solicitudes de verificación (`verification_requests`): el usuario envía
--     el casino, su usuario de ese casino y dos capturas (correo de bienvenida y
--     primer depósito). El admin aprueba o rechaza y las capturas se borran.
--     Un usuario de casino solo puede verificar una cuenta de la shop.
--   · Tramos por casinos verificados (`users.verified_casinos`): 1 casino = 10
--     puntos VIP por minuto, 2 = 15, 3 o más = 20 (ajustes de la tienda).
--   · Pujas VIP: se abren en la fecha del ajuste `shop.vipOpensAt` (el último
--     directo del mes), y como mucho un premio VIP por persona y mes.
--   · Los puntos VIP NO se pueden jugar: ninguna función de juegos, cajas ni
--     sorteos conoce `vip_move`; solo las pujas (place_bid y compañía).
--
-- place_bid, auction_settle, auction_release_hold y order_review son las mismas
-- de la 0023/0012 cambiando `points_move(...)` por `wallet_move(moneda, ...)`.
-- place_bid añade los errores VERIFIED_REQUIRED, VIP_NOT_OPEN,
-- VIP_WIN_CAP_REACHED y VIP_ALREADY_LEADING.

SET search_path TO public;

-- ───────────────────────── columnas ─────────────────────────

ALTER TABLE products ADD COLUMN IF NOT EXISTS category text; -- la de la 0031
ALTER TABLE products ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'points';
DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_currency_valid CHECK (currency IN ('points', 'vip'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'points';
DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_currency_valid CHECK (currency IN ('points', 'vip'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_at integer;
-- Casinos distintos con verificación aprobada: decide el tramo de puntos VIP.
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_casinos integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS vip_points integer NOT NULL DEFAULT 0; -- saldo disponible
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_vip_points_nonneg CHECK (vip_points >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────── libro de movimientos VIP ─────────────────────────

CREATE TABLE IF NOT EXISTS vip_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  amount integer NOT NULL,            -- efecto sobre el saldo (+/-)
  op text NOT NULL,                   -- credit | debit | refund | revoke
  kind text NOT NULL,                 -- motivo: watch, bid_hold, bid_refund, admin_add, ...
  ref_type text,
  ref_id text,
  idempotency_key text UNIQUE,
  meta jsonb,
  balance_after integer NOT NULL,
  created_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vip_transactions_user_created
  ON vip_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vip_transactions_ref
  ON vip_transactions (ref_type, ref_id);

-- Mueve puntos VIP. Misma firma y mismos errores que points_move, con un saldo
-- único (no hay «retenido»: una puja lo descuenta y una devolución lo repone).
--   credit  suma            refund  repone lo descontado por una puja
--   debit   resta (falla sin saldo o si está baneado)
--   revoke  quita saldo (admin, reinicio mensual)
CREATE OR REPLACE FUNCTION vip_move(
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
  v_balance integer;
  v_banned boolean;
  v_signed integer;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  SELECT vip_points, COALESCE(is_banned, false)
    INTO v_balance, v_banned
    FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM vip_transactions WHERE idempotency_key = p_idempotency_key
  ) THEN
    RETURN v_balance;
  END IF;

  IF p_op IN ('credit', 'refund') THEN
    v_signed := p_amount;
  ELSIF p_op = 'debit' THEN
    IF v_banned THEN
      RAISE EXCEPTION 'USER_BANNED';
    END IF;
    IF v_balance < p_amount THEN
      RAISE EXCEPTION 'INSUFFICIENT_POINTS';
    END IF;
    v_signed := -p_amount;
  ELSIF p_op = 'revoke' THEN
    IF v_balance < p_amount THEN
      RAISE EXCEPTION 'INSUFFICIENT_POINTS';
    END IF;
    v_signed := -p_amount;
  ELSE
    RAISE EXCEPTION 'INVALID_OP';
  END IF;

  v_balance := v_balance + v_signed;
  UPDATE users SET vip_points = v_balance WHERE id = p_user_id;

  INSERT INTO vip_transactions
    (user_id, amount, op, kind, ref_type, ref_id, idempotency_key, meta, balance_after, created_at)
  VALUES
    (p_user_id, v_signed, p_op, p_kind, p_ref_type, p_ref_id, p_idempotency_key, p_meta, v_balance, v_now);

  RETURN v_balance;
END $$;

-- Mueve la moneda que toque: 'vip' -> vip_move; cualquier otra -> points_move.
CREATE OR REPLACE FUNCTION wallet_move(
  p_currency text,
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
BEGIN
  IF p_currency = 'vip' THEN
    RETURN vip_move(p_user_id, p_amount, p_op, p_kind, p_ref_type, p_ref_id, p_idempotency_key, p_meta);
  END IF;
  RETURN points_move(p_user_id, p_amount, p_op, p_kind, p_ref_type, p_ref_id, p_idempotency_key, p_meta);
END $$;

-- ───────────────────── reparto por minuto de directo ─────────────────────
-- Se llama justo después de economy_watch_tick con los mismos criterios de
-- actividad (ha escrito en el chat dentro de la ventana, no baneado), pero solo
-- paga a los verificados. Lo que cobra cada uno depende de en cuántos casinos
-- está verificado: 1, 2, o 3 o más. Idempotente por usuario y minuto.

DROP FUNCTION IF EXISTS vip_watch_tick(integer, integer);
CREATE OR REPLACE FUNCTION vip_watch_tick(
  p_rate_one integer, p_rate_two integer, p_rate_three integer, p_chat_window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_minute bigint := floor(extract(epoch FROM now()) / 60)::bigint;
  v_one integer := GREATEST(COALESCE(p_rate_one, 0), 0);
  v_two integer := GREATEST(COALESCE(p_rate_two, p_rate_one, 0), 0);
  v_three integer := GREATEST(COALESCE(p_rate_three, p_rate_two, p_rate_one, 0), 0);
  r record;
  v_key text;
  v_amount integer;
  v_paid integer := 0;
  v_points bigint := 0;
BEGIN
  IF v_one <= 0 AND v_two <= 0 AND v_three <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'minute', v_minute, 'paid', 0, 'points', 0);
  END IF;
  IF p_chat_window_seconds IS NULL OR p_chat_window_seconds < 1 THEN
    RAISE EXCEPTION 'INVALID_ECONOMY_CONFIG';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stream_sessions WHERE ended_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_LIVE');
  END IF;

  FOR r IN
    SELECT u.id, u.verified_casinos
      FROM chat_activity ca
      JOIN users u ON u.id = ca.user_id
     WHERE ca.last_chat_at >= v_now - p_chat_window_seconds
       AND NOT COALESCE(u.is_banned, false)
       AND u.is_verified
     ORDER BY u.id
  LOOP
    v_amount := CASE WHEN r.verified_casinos >= 3 THEN v_three
                     WHEN r.verified_casinos = 2 THEN v_two
                     ELSE v_one END;
    v_key := 'vip_watch:' || r.id || ':' || v_minute;
    IF v_amount > 0 AND NOT EXISTS (SELECT 1 FROM vip_transactions WHERE idempotency_key = v_key) THEN
      PERFORM vip_move(r.id, v_amount, 'credit', 'watch', 'watch_tick', v_minute::text, v_key,
                       jsonb_build_object('casinos', r.verified_casinos));
      v_paid := v_paid + 1;
      v_points := v_points + v_amount;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'minute', v_minute, 'paid', v_paid, 'points', v_points);
END $$;

-- ───────────────────── reinicio mensual ─────────────────────
-- Los puntos VIP se reinician el día 1, como los normales (ajuste
-- `shop.vipMonthlyReset`, activado por defecto). Igual que
-- economy_reset_balances: por tandas e idempotente por mes y usuario.

CREATE OR REPLACE FUNCTION vip_reset_balances(p_month text, p_limit integer DEFAULT 500)
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
     WHERE u.vip_points > 0
       AND NOT EXISTS (
         SELECT 1 FROM vip_transactions vt
          WHERE vt.idempotency_key = 'vip_monthly_reset:' || p_month || ':' || u.id)
     ORDER BY u.id
     LIMIT p_limit
  LOOP
    SELECT vip_points INTO v_bal FROM users WHERE id = r.id FOR UPDATE;
    IF v_bal > 0 THEN
      PERFORM vip_move(
        r.id, v_bal, 'revoke', 'monthly_reset', 'monthly_reset', p_month,
        'vip_monthly_reset:' || p_month || ':' || r.id
      );
      v_done := v_done + 1;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_remaining FROM users u
   WHERE u.vip_points > 0
     AND NOT EXISTS (
       SELECT 1 FROM vip_transactions vt
        WHERE vt.idempotency_key = 'vip_monthly_reset:' || p_month || ':' || u.id);

  RETURN jsonb_build_object('processed', v_done, 'remaining', v_remaining);
END $$;

-- ───────────────────── solicitudes de verificación ─────────────────────
-- El usuario se registra en un casino desde la página de Bonos, hace un primer
-- depósito de 30 € o más y envía: el casino, su usuario de ese casino y dos
-- capturas (correo de bienvenida y depósito). El admin lo comprueba a mano y
-- aprueba o rechaza; al resolver, el servidor borra las capturas y aquí solo
-- queda casino, usuario del casino, estado y fecha (el importe no se guarda).
--
-- Reglas: como mucho una solicitud pendiente por usuario; un usuario de casino
-- solo puede verificar una cuenta de la shop; una misma cuenta puede verificarse
-- en varios casinos (una solicitud por casino) y eso decide su tramo de puntos.

CREATE TABLE IF NOT EXISTS verification_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  casino text NOT NULL,            -- casino en el que se registró (nombre de la lista de bonos)
  casino_username text NOT NULL,   -- su usuario en ese casino
  status text NOT NULL DEFAULT 'pending',
  note text,                       -- motivo del rechazo; se le enseña al usuario
  welcome_proof text,              -- ruta en el almacenamiento privado; NULL al resolver
  deposit_proof text,              -- ídem
  created_at integer NOT NULL,
  reviewed_at integer,
  reviewed_by text
);
ALTER TABLE verification_requests ADD COLUMN IF NOT EXISTS welcome_proof text;
ALTER TABLE verification_requests ADD COLUMN IF NOT EXISTS deposit_proof text;
ALTER TABLE verification_requests DROP CONSTRAINT IF EXISTS verification_requests_status_check;
ALTER TABLE verification_requests ADD CONSTRAINT verification_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'revoked'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_verification_requests_pending
  ON verification_requests (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_verification_requests_status
  ON verification_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_verification_requests_user
  ON verification_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_requests_casino_user
  ON verification_requests (lower(casino), lower(casino_username));

-- Recalcula en cuántos casinos distintos está verificado el usuario y, con
-- eso, si está verificado. Devuelve el número de casinos.
CREATE OR REPLACE FUNCTION verification_recount(p_user_id integer) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_count integer;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  SELECT count(DISTINCT lower(casino))::integer INTO v_count
    FROM verification_requests
   WHERE user_id = p_user_id AND status = 'approved';

  UPDATE users
     SET verified_casinos = v_count,
         is_verified = v_count > 0,
         verified_at = CASE WHEN v_count = 0 THEN NULL ELSE COALESCE(verified_at, v_now) END
   WHERE id = p_user_id;
  RETURN v_count;
END $$;

-- Crea la solicitud. Errores: INVALID_REQUEST, USER_NOT_FOUND, USER_BANNED,
-- REQUEST_PENDING, CASINO_ALREADY_VERIFIED (ya está verificado en ese casino) y
-- CASINO_USER_TAKEN (ese usuario de casino ya lo usa otra cuenta de la shop).
DROP FUNCTION IF EXISTS verification_request(integer, text, text);
CREATE OR REPLACE FUNCTION verification_request(
  p_user_id integer, p_casino text, p_casino_username text,
  p_welcome_proof text, p_deposit_proof text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  u users%ROWTYPE;
  v_casino text := btrim(COALESCE(p_casino, ''));
  v_name text := btrim(COALESCE(p_casino_username, ''));
  v_welcome text := NULLIF(btrim(COALESCE(p_welcome_proof, '')), '');
  v_deposit text := NULLIF(btrim(COALESCE(p_deposit_proof, '')), '');
  v_id bigint;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  IF v_casino = '' OR v_name = '' OR length(v_casino) > 120 OR length(v_name) > 80
     OR v_welcome IS NULL OR v_deposit IS NULL THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;

  -- Dos cuentas no pueden pedir a la vez el mismo usuario de casino.
  PERFORM pg_advisory_xact_lock(hashtext('verification:' || lower(v_casino) || ':' || lower(v_name)));

  SELECT * INTO u FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  IF COALESCE(u.is_banned, false) THEN
    RAISE EXCEPTION 'USER_BANNED';
  END IF;
  IF EXISTS (SELECT 1 FROM verification_requests WHERE user_id = p_user_id AND status = 'pending') THEN
    RAISE EXCEPTION 'REQUEST_PENDING';
  END IF;
  IF EXISTS (SELECT 1 FROM verification_requests
              WHERE user_id = p_user_id AND status = 'approved' AND lower(casino) = lower(v_casino)) THEN
    RAISE EXCEPTION 'CASINO_ALREADY_VERIFIED';
  END IF;
  IF EXISTS (SELECT 1 FROM verification_requests
              WHERE user_id <> p_user_id AND status IN ('pending', 'approved')
                AND lower(casino) = lower(v_casino) AND lower(casino_username) = lower(v_name)) THEN
    RAISE EXCEPTION 'CASINO_USER_TAKEN';
  END IF;

  INSERT INTO verification_requests (user_id, casino, casino_username, welcome_proof, deposit_proof, created_at)
  VALUES (p_user_id, v_casino, v_name, v_welcome, v_deposit, v_now)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'status', 'pending', 'casino', v_casino,
                            'casino_username', v_name, 'created_at', v_now);
END $$;

-- Resuelve una solicitud pendiente. Aprobar verifica al usuario en la misma
-- transacción (y recalcula su tramo). Devuelve action: approved | rejected |
-- none (ya estaba resuelta). Las capturas las borra el servidor después.
CREATE OR REPLACE FUNCTION verification_review(p_request_id bigint, p_approve boolean, p_admin text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r verification_requests%ROWTYPE;
  v_casinos integer;
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
  END IF;

  RETURN jsonb_build_object('action', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
                            'user_id', r.user_id, 'casinos', v_casinos);
END $$;

-- Retira una verificación ya aprobada (un casino concreto) y recalcula el tramo.
CREATE OR REPLACE FUNCTION verification_revoke(p_request_id bigint, p_admin text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r verification_requests%ROWTYPE;
  v_casinos integer;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  SELECT * INTO r FROM verification_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
  END IF;
  IF r.status <> 'approved' THEN
    RETURN jsonb_build_object('action', 'none', 'status', r.status, 'user_id', r.user_id);
  END IF;

  PERFORM 1 FROM users WHERE id = r.user_id FOR UPDATE;

  UPDATE verification_requests
     SET status = 'revoked',
         note = NULLIF(btrim(COALESCE(p_note, '')), ''),
         reviewed_at = v_now,
         reviewed_by = p_admin
   WHERE id = r.id;

  v_casinos := verification_recount(r.user_id);
  RETURN jsonb_build_object('action', 'revoked', 'user_id', r.user_id, 'casinos', v_casinos);
END $$;

-- Marca o desmarca a mano a una cuenta entera (panel de usuarios). Desmarcar
-- retira todas sus verificaciones; marcar sin solicitudes cuenta como 1 casino.
-- Devuelve false si el usuario no existe.
CREATE OR REPLACE FUNCTION verification_set_user(p_user_id integer, p_verified boolean, p_admin text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  PERFORM 1 FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_verified THEN
    UPDATE users
       SET is_verified = true,
           verified_casinos = GREATEST(verified_casinos, 1),
           verified_at = COALESCE(verified_at, v_now)
     WHERE id = p_user_id;
  ELSE
    UPDATE verification_requests
       SET status = 'revoked', reviewed_at = v_now, reviewed_by = p_admin
     WHERE user_id = p_user_id AND status = 'approved';
    UPDATE users
       SET is_verified = false, verified_casinos = 0, verified_at = NULL
     WHERE id = p_user_id;
  END IF;
  RETURN true;
END $$;

-- ───────────────────── pujas con la moneda del premio ─────────────────────

-- Premios ganados en el mes en una moneda. Los premios VIP y los normales
-- llevan topes separados: los normales el del ajuste, los VIP uno al mes.
CREATE OR REPLACE FUNCTION auction_wins_in_month(p_user_id integer, p_now integer, p_currency text)
RETURNS integer
LANGUAGE sql STABLE
SET search_path FROM CURRENT
AS $$
  SELECT count(*)::integer
    FROM orders
   WHERE user_id = p_user_id
     AND bid_round IS NOT NULL
     AND status <> 2
     AND currency = p_currency
     AND ad_month(created_at) = ad_month(p_now)
$$;

-- ¿Están abiertas las pujas VIP? Se abren en la fecha del ajuste
-- `shop.vipOpensAt` (el último directo del mes) y solo valen dentro de ese mes:
-- al cambiar de mes vuelven a estar cerradas hasta que se ponga otra fecha.
CREATE OR REPLACE FUNCTION vip_bids_open(p_now integer) RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path FROM CURRENT
AS $$
DECLARE
  v_opens bigint := shop_cfg('vipOpensAt', 0)::bigint;
BEGIN
  RETURN v_opens > 0 AND p_now >= v_opens AND ad_month(v_opens::integer) = ad_month(p_now);
END $$;

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
  -- Premio en puntos VIP: no se puja hasta el último directo del mes.
  IF p.currency = 'vip' AND NOT vip_bids_open(v_now) THEN
    RAISE EXCEPTION 'VIP_NOT_OPEN';
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
  ELSIF auction_wins_in_month(p_user_id, v_now, 'points') >= v_cap THEN
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
    v_balance := wallet_move(p.currency, p_user_id, p_amount - v_prev_amount, 'debit', 'bid_hold', 'product', p.id::text,
                             NULL, jsonb_build_object('bid_id', v_bid_id, 'round', p.auction_round));
  ELSE
    v_balance := wallet_move(p.currency, p_user_id, p_amount, 'debit', 'bid_hold', 'product', p.id::text,
                             NULL, jsonb_build_object('bid_id', v_bid_id, 'round', p.auction_round));
    IF v_prev_user IS NOT NULL AND v_prev_amount > 0 THEN
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
    'previous_amount', v_prev_amount,
    'balance', v_balance,
    'currency', p.currency
  );
END $$;

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
  v_needs_review := COALESCE(p.value_eur, 0) > v_review_eur;

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

  PERFORM wallet_move(p.currency, p.current_bidder_user_id, p.current_bid, 'refund', 'bid_refund', 'product', p.id::text,
                      NULL, jsonb_build_object('reason', 'auction_released', 'round', p.auction_round));

  UPDATE products SET current_bid = 0, current_bidder_user_id = NULL WHERE id = p.id;

  RETURN jsonb_build_object('released', p.current_bid, 'user_id', p.current_bidder_user_id);
END $$;

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
    PERFORM wallet_move(o.currency, o.user_id, o.total, 'refund', 'order_refund', 'order', o.id::text,
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
    'vip_move(integer, integer, text, text, text, text, text, jsonb)',
    'wallet_move(text, integer, integer, text, text, text, text, text, jsonb)',
    'vip_watch_tick(integer, integer, integer, integer)',
    'vip_reset_balances(text, integer)',
    'verification_request(integer, text, text, text, text)',
    'verification_review(bigint, boolean, text, text)',
    'verification_revoke(bigint, text, text)',
    'verification_set_user(integer, boolean, text)',
    'verification_recount(integer)',
    'auction_wins_in_month(integer, integer, text)',
    'vip_bids_open(integer)',
    'place_bid(integer, integer, integer)',
    'auction_settle(integer, boolean)',
    'auction_release_hold(integer)',
    'order_review(integer, boolean, text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_object THEN NULL; -- roles de Supabase ausentes
    END;
  END LOOP;
END $$;

-- Solo el servidor (service_role) lee y escribe el libro VIP y las solicitudes.
ALTER TABLE vip_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  GRANT ALL ON TABLE vip_transactions TO service_role;
  GRANT ALL ON TABLE verification_requests TO service_role;
EXCEPTION WHEN undefined_object THEN NULL; -- rol de Supabase ausente
END $$;

NOTIFY pgrst, 'reload schema';
