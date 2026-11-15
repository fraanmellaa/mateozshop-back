-- 0024: cajas con aleatoriedad verificable y premios de respaldo; sorteos
-- verificables (compromiso-revelación) con bases; requisitos de compra.
--
-- Aplicar a mano en el SQL editor de Supabase DESPUÉS de la 0012, la 0017 y la
-- 0019 (usa points_move, loot_box_*, fair_random_hex y fair_hash). Es
-- idempotente.
--
-- Qué cambia:
--   · loot_box_prizes.fallback_points: puntos que se dan si un premio con stock
--     se agota y aun así sale sorteado (el premio agotado SIGUE en el pool).
--   · loot_box_openings: guarda hash de la semilla de servidor, semilla de
--     cliente y nonce de la tirada, y si se entregó el respaldo.
--   · open_loot_box(integer, integer, integer, jsonb): versión nueva con datos
--     verificables. La de 3 argumentos NO se toca.
--   · giveaways: draw_seed (secreta hasta el sorteo), draw_seed_hash (pública),
--     rules (bases), drawn_at y draw_log (lista de entradas usada en el sorteo).
--   · buy_giveaway_ticket: añade cuenta vinculada (Kick O Twitch), +18 y
--     antigüedad mínima de la cuenta.

SET search_path TO public;

-- ───────────────────────── cajas ─────────────────────────

ALTER TABLE loot_box_prizes ADD COLUMN IF NOT EXISTS fallback_points integer;

DO $$ BEGIN
  ALTER TABLE loot_box_prizes ADD CONSTRAINT loot_box_prizes_fallback_points_positive
    CHECK (fallback_points IS NULL OR fallback_points >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Los premios que ya tenían stock no tenían respaldo: se les pone sus puntos
-- (o 100 si son objeto). El admin debe revisarlos desde el panel.
UPDATE loot_box_prizes
   SET fallback_points = GREATEST(1, COALESCE(points, 100))
 WHERE stock IS NOT NULL AND fallback_points IS NULL;

DO $$ BEGIN
  ALTER TABLE loot_box_prizes ADD CONSTRAINT loot_box_prizes_stock_needs_fallback
    CHECK (stock IS NULL OR fallback_points IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE loot_box_openings ADD COLUMN IF NOT EXISTS server_seed_hash text;
ALTER TABLE loot_box_openings ADD COLUMN IF NOT EXISTS client_seed text;
ALTER TABLE loot_box_openings ADD COLUMN IF NOT EXISTS fair_nonce bigint;
ALTER TABLE loot_box_openings ADD COLUMN IF NOT EXISTS fallback boolean NOT NULL DEFAULT false;

-- ───────────────────── requisitos de cuenta (compartidos) ─────────────────────

-- Antigüedad mínima (días) para gastar en cajas y sorteos: app_settings 'shop'
-- → minAccountAgeDays (30 por defecto, 0–3650).
CREATE OR REPLACE FUNCTION redeem_min_account_age_days() RETURNS integer
LANGUAGE sql STABLE
SET search_path FROM CURRENT
AS $$
  SELECT COALESCE(
    (SELECT LEAST(GREATEST((value->>'minAccountAgeDays')::numeric, 0), 3650)::integer
       FROM app_settings
      WHERE key = 'shop' AND jsonb_typeof(value->'minAccountAgeDays') = 'number'),
    30
  )
$$;

-- Twitch cuenta desde su creación; Kick desde la vinculación (no expone la fecha
-- de creación). Basta con que una de las dos tenga la antigüedad pedida.
CREATE OR REPLACE FUNCTION redeem_account_old_enough(
  p_twitch_created_at integer,
  p_kick_linked_at integer,
  p_min_days integer,
  p_now integer
) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT (p_twitch_created_at IS NOT NULL AND p_now - p_twitch_created_at >= p_min_days::bigint * 86400)
      OR (p_kick_linked_at IS NOT NULL AND p_now - p_kick_linked_at >= p_min_days::bigint * 86400)
$$;

-- ───────────────────── abrir una caja (verificable) ─────────────────────
-- p_prize_id y p_fair los pone el back (utils/lootBoxes + utils/fair).
-- p_fair = {server_seed_hash, client_seed, nonce}. Si el premio está activo
-- pero sin stock NO falla: abona fallback_points en su lugar (fallback = true).
-- Errores: BOX_NOT_FOUND, BOX_NOT_ACTIVE, PRIZE_UNAVAILABLE, USER_NOT_FOUND,
-- USER_ACCOUNT_NOT_LINKED, ADULT_REQUIRED, ACCOUNT_TOO_NEW (DETAIL = días),
-- FAIR_DATA_REQUIRED, USER_BANNED, INSUFFICIENT_POINTS.

CREATE OR REPLACE FUNCTION open_loot_box(
  p_user_id integer,
  p_box_id integer,
  p_prize_id integer,
  p_fair jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  b loot_boxes%ROWTYPE;
  pr loot_box_prizes%ROWTYPE;
  v_kick text;
  v_twitch text;
  v_adult integer;
  v_twitch_created integer;
  v_kick_linked integer;
  v_min_days integer;
  v_opening bigint;
  v_balance integer;
  v_status text;
  v_kind text;
  v_awarded integer;
  v_fallback boolean;
  v_hash text := p_fair->>'server_seed_hash';
  v_client text := p_fair->>'client_seed';
  v_nonce bigint;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  IF v_hash IS NULL OR v_client IS NULL OR p_fair->>'nonce' IS NULL THEN
    RAISE EXCEPTION 'FAIR_DATA_REQUIRED';
  END IF;
  v_nonce := (p_fair->>'nonce')::bigint;

  SELECT * INTO b FROM loot_boxes WHERE id = p_box_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOX_NOT_FOUND';
  END IF;
  IF NOT b.is_active THEN
    RAISE EXCEPTION 'BOX_NOT_ACTIVE';
  END IF;

  -- Bloquea el premio: dos aperturas a la vez no pueden gastar la misma unidad.
  SELECT * INTO pr FROM loot_box_prizes WHERE id = p_prize_id AND box_id = p_box_id FOR UPDATE;
  IF NOT FOUND OR NOT pr.is_active THEN
    RAISE EXCEPTION 'PRIZE_UNAVAILABLE';
  END IF;

  SELECT kick_id, twitch_id, adult_confirmed_at, twitch_created_at, kick_linked_at
    INTO v_kick, v_twitch, v_adult, v_twitch_created, v_kick_linked
    FROM users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  IF v_kick IS NULL AND v_twitch IS NULL THEN
    RAISE EXCEPTION 'USER_ACCOUNT_NOT_LINKED';
  END IF;
  IF v_adult IS NULL THEN
    RAISE EXCEPTION 'ADULT_REQUIRED';
  END IF;
  v_min_days := redeem_min_account_age_days();
  IF NOT redeem_account_old_enough(v_twitch_created, v_kick_linked, v_min_days, v_now) THEN
    RAISE EXCEPTION 'ACCOUNT_TOO_NEW' USING DETAIL = v_min_days::text;
  END IF;

  -- Sin stock: se da el respaldo en puntos en lugar del objeto.
  v_fallback := pr.stock IS NOT NULL AND pr.stock <= 0;
  IF v_fallback AND (pr.fallback_points IS NULL OR pr.fallback_points < 1) THEN
    RAISE EXCEPTION 'PRIZE_UNAVAILABLE';
  END IF;

  IF v_fallback OR pr.kind = 'points' THEN
    v_kind := 'points';
    v_status := 'completed';
    v_awarded := CASE WHEN v_fallback THEN pr.fallback_points ELSE pr.points END;
  ELSE
    v_kind := 'item';
    v_status := 'pending';
    v_awarded := 0;
  END IF;

  INSERT INTO loot_box_openings
    (user_id, box_id, prize_id, box_name, prize_name, rarity, kind,
     points_awarded, price_paid, status, created_at,
     server_seed_hash, client_seed, fair_nonce, fallback)
  VALUES
    (p_user_id, b.id, pr.id, b.name, pr.name, pr.rarity, v_kind,
     v_awarded, b.price, v_status, v_now,
     v_hash, v_client, v_nonce, v_fallback)
  RETURNING id INTO v_opening;

  -- Cobra la caja (lanza USER_BANNED / INSUFFICIENT_POINTS y revierte todo).
  v_balance := points_move(
    p_user_id, b.price, 'debit', 'loot_box_open', 'loot_box_opening', v_opening::text,
    NULL, jsonb_build_object('fair_nonce', v_nonce)
  );

  IF pr.stock IS NOT NULL AND NOT v_fallback THEN
    UPDATE loot_box_prizes SET stock = stock - 1 WHERE id = pr.id;
  END IF;

  IF v_awarded > 0 THEN
    v_balance := points_move(
      p_user_id, v_awarded, 'credit', 'loot_box_prize', 'loot_box_opening', v_opening::text,
      'loot_box_opening:' || v_opening::text || ':prize',
      jsonb_build_object('fallback', v_fallback)
    );
  END IF;

  RETURN jsonb_build_object(
    'opening_id', v_opening,
    'box_id', b.id,
    'prize_id', pr.id,
    'prize_name', pr.name,
    'rarity', pr.rarity,
    'kind', v_kind,
    'points_awarded', v_awarded,
    'fallback', v_fallback,
    'status', v_status,
    'balance', v_balance
  );
END $$;

-- ───────────────────── comprar un ticket de sorteo ─────────────────────
-- Misma firma y cuerpo que la 0012, más cuenta vinculada (Kick O Twitch),
-- +18 y antigüedad de cuenta.

CREATE OR REPLACE FUNCTION buy_giveaway_ticket(p_user_id integer, p_giveaway_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  g giveaways%ROWTYPE;
  v_kick text;
  v_twitch text;
  v_adult integer;
  v_twitch_created integer;
  v_kick_linked integer;
  v_min_days integer;
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

  SELECT kick_id, twitch_id, adult_confirmed_at, twitch_created_at, kick_linked_at
    INTO v_kick, v_twitch, v_adult, v_twitch_created, v_kick_linked
    FROM users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  IF v_kick IS NULL AND v_twitch IS NULL THEN
    RAISE EXCEPTION 'USER_ACCOUNT_NOT_LINKED';
  END IF;
  IF v_adult IS NULL THEN
    RAISE EXCEPTION 'ADULT_REQUIRED';
  END IF;
  v_min_days := redeem_min_account_age_days();
  IF NOT redeem_account_old_enough(v_twitch_created, v_kick_linked, v_min_days, v_now) THEN
    RAISE EXCEPTION 'ACCOUNT_TOO_NEW' USING DETAIL = v_min_days::text;
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

-- ───────────────────── sorteos verificables ─────────────────────

ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS draw_seed text;
ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS draw_seed_hash text;
ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS rules text;
ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS drawn_at integer;
-- Lista usada en el sorteo: {n, index, winner_entry_id, entry_ids[], excluded_entry_ids[]}.
ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS draw_log jsonb;

-- Sorteos existentes sin ganador (y aún abiertos): semilla y compromiso.
UPDATE giveaways
   SET draw_seed = fair_random_hex()
 WHERE draw_seed IS NULL AND winner IS NULL AND is_closed = false;
UPDATE giveaways
   SET draw_seed_hash = fair_hash(draw_seed)
 WHERE draw_seed IS NOT NULL AND draw_seed_hash IS NULL;

-- Todo sorteo nuevo nace con su semilla secreta y su hash público.
CREATE OR REPLACE FUNCTION giveaways_set_draw_seed() RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF NEW.draw_seed IS NULL THEN
    NEW.draw_seed := fair_random_hex();
  END IF;
  NEW.draw_seed_hash := fair_hash(NEW.draw_seed);
  RETURN NEW;
END $$;

-- Una vez publicado el hash, la semilla no se puede cambiar.
CREATE OR REPLACE FUNCTION giveaways_lock_draw_seed() RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF OLD.draw_seed IS NOT NULL
     AND (NEW.draw_seed IS DISTINCT FROM OLD.draw_seed
          OR NEW.draw_seed_hash IS DISTINCT FROM OLD.draw_seed_hash) THEN
    RAISE EXCEPTION 'DRAW_SEED_LOCKED';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_giveaways_set_draw_seed ON giveaways;
CREATE TRIGGER trg_giveaways_set_draw_seed
  BEFORE INSERT ON giveaways
  FOR EACH ROW EXECUTE FUNCTION giveaways_set_draw_seed();

DROP TRIGGER IF EXISTS trg_giveaways_lock_draw_seed ON giveaways;
CREATE TRIGGER trg_giveaways_lock_draw_seed
  BEFORE UPDATE ON giveaways
  FOR EACH ROW EXECUTE FUNCTION giveaways_lock_draw_seed();

-- ───────────────────── permisos ─────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'open_loot_box(integer, integer, integer, jsonb)',
    'buy_giveaway_ticket(integer, integer)',
    'redeem_min_account_age_days()',
    'redeem_account_old_enough(integer, integer, integer, integer)',
    'giveaways_set_draw_seed()',
    'giveaways_lock_draw_seed()'
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
  FOREACH t IN ARRAY ARRAY['loot_boxes', 'loot_box_prizes', 'loot_box_openings', 'giveaways', 'giveaways_entries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('GRANT ALL ON TABLE %I TO service_role', t);
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
