-- 0043 · Stock compartido entre premios, con relleno mensual
--
-- Aplicar a mano en el SQL editor de Supabase, después de la 0039. Se puede
-- ejecutar más de una vez. No cambia ninguna función existente (place_bid,
-- auction_settle, order_pass_next…): siguen leyendo `products.stock` como
-- siempre.
--
-- Para qué: las tiradas de Casino Barcelona son tres premios (una slot cada
-- uno) que comparten un único stock de 100 al mes. Los crea la 0044.
--
-- Cómo funciona
--   · `stock_groups`: un grupo por stock compartido, con su stock del mes
--     (`monthly_stock`) y el mes del último relleno (`month`, 'YYYY-MM').
--   · `products.stock_group`: grupo al que pertenece el premio (NULL = stock
--     propio, como hasta ahora).
--   · Un disparador copia el stock a los demás premios del grupo cada vez que
--     cambia en uno: al adjudicar una unidad (-1), al devolver un premio a la
--     tienda (+1) o al editarlo en el panel. Así los tres enseñan siempre lo
--     que queda del grupo.
--   · Con el grupo a 0, los premios que esperan dejan de salir en la tienda
--     (la web ya esconde los que están sin stock y sin puja) y no se puede
--     abrir una puja nueva (OUT_OF_STOCK). Si quedaba una unidad y había dos
--     pujas en marcha, gana la que acaba primero; a la otra se le devuelven
--     los puntos (auction_settle ya lo hace cuando no hay stock).
--   · `shop_stock_groups_refill(mes)`: lo llama el reinicio mensual después de
--     cerrar las pujas del mes. Devuelve cada grupo a su stock del mes y deja
--     sus premios esperando la primera puja. Solo actúa una vez por mes.
--
-- Para cambiar el stock del mes de un grupo:
--   UPDATE stock_groups SET monthly_stock = 150 WHERE key = 'casino-barcelona-fs';
-- (vale a partir del siguiente relleno; para cambiar lo que queda este mes,
-- edita el stock de cualquiera de sus premios en el panel).

SET search_path TO public;

-- ───────────────────────── tablas y columnas ─────────────────────────

CREATE TABLE IF NOT EXISTS stock_groups (
  key text PRIMARY KEY,
  monthly_stock integer NOT NULL CHECK (monthly_stock BETWEEN 0 AND 100000),
  month text                                  -- 'YYYY-MM' del último relleno
);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS stock_group text
  REFERENCES stock_groups (key) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_stock_group_idx
  ON products (stock_group) WHERE stock_group IS NOT NULL;

-- ───────────────────────── disparador ─────────────────────────

-- Copia el stock a los demás premios del grupo. La marca de sesión evita que
-- las filas que actualiza el propio disparador vuelvan a repartir.
CREATE OR REPLACE FUNCTION products_sync_stock_group() RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF COALESCE(current_setting('mateoz.skip_stock_sync', true), '') = '1' THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('mateoz.skip_stock_sync', '1', true);
  UPDATE products
     SET stock = GREATEST(NEW.stock, 0)
   WHERE stock_group = NEW.stock_group
     AND id <> NEW.id
     AND stock IS DISTINCT FROM GREATEST(NEW.stock, 0);
  PERFORM set_config('mateoz.skip_stock_sync', '', true);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_products_sync_stock_group ON products;
CREATE TRIGGER trg_products_sync_stock_group
AFTER UPDATE OF stock ON products
FOR EACH ROW
WHEN (NEW.stock_group IS NOT NULL AND NEW.stock IS DISTINCT FROM OLD.stock)
EXECUTE FUNCTION products_sync_stock_group();

-- ───────────────────────── relleno mensual ─────────────────────────

CREATE OR REPLACE FUNCTION shop_stock_groups_refill(p_month text) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  g stock_groups%ROWTYPE;
  v_refilled integer := 0;
BEGIN
  IF p_month IS NULL OR p_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'INVALID_MONTH';
  END IF;

  -- Aquí se escribe el stock de todo el grupo a la vez: el disparador sobra.
  PERFORM set_config('mateoz.skip_stock_sync', '1', true);

  FOR g IN
    SELECT * FROM stock_groups
     WHERE month IS DISTINCT FROM p_month
     ORDER BY key
       FOR UPDATE
  LOOP
    -- Premios sin puja en marcha: vuelven a esperar la primera puja. El que
    -- se quedó archivado al adjudicar la última unidad empieza ronda nueva.
    IF g.monthly_stock > 0 THEN
      UPDATE products
         SET stock = g.monthly_stock,
             auction_round = auction_round
               + CASE WHEN auction_status IN ('archived', 'finalized') THEN 1 ELSE 0 END,
             auction_status = 'waiting',
             auction_ends_at = NULL,
             auction_reopens_at = NULL,
             current_bid = 0,
             current_bidder_user_id = NULL,
             auction_prize_assigned = false
       WHERE stock_group = g.key
         AND auction_status IN ('waiting', 'archived', 'finalized');
    ELSE
      UPDATE products SET stock = 0
       WHERE stock_group = g.key
         AND auction_status IN ('waiting', 'archived', 'finalized');
    END IF;

    -- Con una puja en marcha solo cambia el stock.
    UPDATE products SET stock = g.monthly_stock
     WHERE stock_group = g.key
       AND auction_status NOT IN ('waiting', 'archived', 'finalized');

    UPDATE stock_groups SET month = p_month WHERE key = g.key;
    v_refilled := v_refilled + 1;
  END LOOP;

  PERFORM set_config('mateoz.skip_stock_sync', '', true);
  RETURN jsonb_build_object('refilled', v_refilled);
END $$;

-- ───────────────────────── permisos ─────────────────────────

ALTER TABLE stock_groups ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  fn text;
BEGIN
  BEGIN
    GRANT ALL ON TABLE stock_groups TO service_role;
  EXCEPTION WHEN undefined_object THEN NULL; -- roles de Supabase ausentes
  END;

  FOREACH fn IN ARRAY ARRAY[
    'products_sync_stock_group()',
    'shop_stock_groups_refill(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
