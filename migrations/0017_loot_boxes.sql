-- 0017: cajas de la tienda de puntos (premios por categoría).
--
-- Aplicar a mano en el SQL editor de Supabase DESPUÉS de la 0012 (usa
-- points_move). Es idempotente.
--
-- Cómo funciona:
--   · Una caja cuesta `price` puntos. Cada caja reparte la probabilidad entre
--     las cuatro categorías (común, raro, épico, legendario) con pesos en
--     puntos básicos: suman exactamente 10000 (100,00 %).
--   · Dentro de una categoría se elige un premio según su `weight` relativo.
--   · Un premio es `points` (se abonan al instante) o `item` (free spins,
--     objetos exclusivos...: queda pendiente de entrega manual desde el panel).
--   · El sorteo lo hace el back con crypto.randomInt; open_loot_box solo
--     valida y ejecuta de forma atómica (cobro, stock, premio y registro).
--   · Las cajas nacen DESACTIVADAS: hay que configurarlas y activarlas.

SET search_path TO public;

-- ───────────────────────── cajas ─────────────────────────

CREATE TABLE IF NOT EXISTS loot_boxes (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  description text,
  image text,
  price integer NOT NULL CHECK (price > 0),
  weight_common integer NOT NULL DEFAULT 7000 CHECK (weight_common >= 0),
  weight_rare integer NOT NULL DEFAULT 2200 CHECK (weight_rare >= 0),
  weight_epic integer NOT NULL DEFAULT 700 CHECK (weight_epic >= 0),
  weight_legendary integer NOT NULL DEFAULT 100 CHECK (weight_legendary >= 0),
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT false,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT loot_boxes_weights_sum
    CHECK (weight_common + weight_rare + weight_epic + weight_legendary = 10000)
);

-- ───────────────────────── premios ─────────────────────────

CREATE TABLE IF NOT EXISTS loot_box_prizes (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  box_id integer NOT NULL REFERENCES loot_boxes(id) ON DELETE CASCADE ON UPDATE CASCADE,
  rarity text NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  kind text NOT NULL CHECK (kind IN ('points', 'item')),
  name text NOT NULL,
  description text,
  image text,
  points integer CHECK (points > 0),            -- solo para kind = 'points'
  weight integer NOT NULL DEFAULT 1 CHECK (weight > 0), -- peso relativo dentro de su categoría
  stock integer CHECK (stock >= 0),             -- NULL = ilimitado
  is_active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT loot_box_prizes_kind_points CHECK (
    (kind = 'points' AND points IS NOT NULL) OR (kind = 'item' AND points IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_loot_box_prizes_box ON loot_box_prizes (box_id, rarity);

-- ───────────────────── aperturas (histórico) ─────────────────────
-- Guarda copia de los nombres: sigue siendo legible si se borra la caja o el premio.

CREATE TABLE IF NOT EXISTS loot_box_openings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  box_id integer REFERENCES loot_boxes(id) ON DELETE SET NULL,
  prize_id integer REFERENCES loot_box_prizes(id) ON DELETE SET NULL,
  box_name text NOT NULL,
  prize_name text NOT NULL,
  rarity text NOT NULL,
  kind text NOT NULL,
  points_awarded integer NOT NULL DEFAULT 0,
  price_paid integer NOT NULL,
  -- completed: premio de puntos ya abonado · pending: objeto por entregar ·
  -- delivered: objeto entregado
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'pending', 'delivered')),
  delivery_note text,
  delivered_at integer,
  created_at integer NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_loot_box_openings_user ON loot_box_openings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loot_box_openings_status ON loot_box_openings (status, created_at DESC);

-- ───────────────────── abrir una caja ─────────────────────
-- p_prize_id lo elige el back (aleatoriedad criptográfica); aquí se valida
-- que pertenece a la caja, está activo y tiene stock, y se ejecuta todo en
-- una transacción: cobro de la caja, stock, registro y abono si el premio son
-- puntos. Errores: BOX_NOT_FOUND, BOX_NOT_ACTIVE, PRIZE_UNAVAILABLE,
-- PRIZE_OUT_OF_STOCK, USER_NOT_FOUND, USER_KICK_ID_NOT_FOUND, USER_BANNED,
-- INSUFFICIENT_POINTS.

CREATE OR REPLACE FUNCTION open_loot_box(p_user_id integer, p_box_id integer, p_prize_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  b loot_boxes%ROWTYPE;
  pr loot_box_prizes%ROWTYPE;
  v_kick text;
  v_opening bigint;
  v_balance integer;
  v_status text;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  SELECT * INTO b FROM loot_boxes WHERE id = p_box_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOX_NOT_FOUND';
  END IF;
  IF NOT b.is_active THEN
    RAISE EXCEPTION 'BOX_NOT_ACTIVE';
  END IF;

  SELECT * INTO pr FROM loot_box_prizes WHERE id = p_prize_id AND box_id = p_box_id FOR UPDATE;
  IF NOT FOUND OR NOT pr.is_active THEN
    RAISE EXCEPTION 'PRIZE_UNAVAILABLE';
  END IF;
  IF pr.stock IS NOT NULL AND pr.stock <= 0 THEN
    RAISE EXCEPTION 'PRIZE_OUT_OF_STOCK';
  END IF;

  SELECT kick_id INTO v_kick FROM users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  IF v_kick IS NULL THEN
    RAISE EXCEPTION 'USER_KICK_ID_NOT_FOUND';
  END IF;

  v_status := CASE WHEN pr.kind = 'item' THEN 'pending' ELSE 'completed' END;

  INSERT INTO loot_box_openings
    (user_id, box_id, prize_id, box_name, prize_name, rarity, kind,
     points_awarded, price_paid, status, created_at)
  VALUES
    (p_user_id, b.id, pr.id, b.name, pr.name, pr.rarity, pr.kind,
     CASE WHEN pr.kind = 'points' THEN pr.points ELSE 0 END, b.price, v_status, v_now)
  RETURNING id INTO v_opening;

  -- Cobra la caja (lanza USER_BANNED / INSUFFICIENT_POINTS y revierte todo).
  v_balance := points_move(p_user_id, b.price, 'debit', 'loot_box_open', 'loot_box_opening', v_opening::text);

  IF pr.stock IS NOT NULL THEN
    UPDATE loot_box_prizes SET stock = stock - 1 WHERE id = pr.id;
  END IF;

  IF pr.kind = 'points' THEN
    v_balance := points_move(
      p_user_id, pr.points, 'credit', 'loot_box_prize', 'loot_box_opening', v_opening::text,
      'loot_box_opening:' || v_opening::text || ':prize'
    );
  END IF;

  RETURN jsonb_build_object(
    'opening_id', v_opening,
    'box_id', b.id,
    'prize_id', pr.id,
    'prize_name', pr.name,
    'rarity', pr.rarity,
    'kind', pr.kind,
    'points_awarded', CASE WHEN pr.kind = 'points' THEN pr.points ELSE 0 END,
    'status', v_status,
    'balance', v_balance
  );
END $$;

-- ───────────────────── permisos ─────────────────────
-- Solo el service role (el back) ejecuta la función y lee las tablas.

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION open_loot_box(integer, integer, integer) FROM PUBLIC';
  BEGIN
    EXECUTE 'REVOKE ALL ON FUNCTION open_loot_box(integer, integer, integer) FROM anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION open_loot_box(integer, integer, integer) TO service_role';
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['loot_boxes', 'loot_box_prizes', 'loot_box_openings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('GRANT ALL ON TABLE %I TO service_role', t);
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
