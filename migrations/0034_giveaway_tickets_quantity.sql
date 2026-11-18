-- 0034: comprar varios tickets de sorteo de una vez (18 nov 2026).
--
-- Aplicar a mano en el SQL editor de Supabase DESPUÉS de la 0024. Es idempotente.
--
-- `buy_giveaway_tickets` compra p_quantity tickets del mismo sorteo en una sola
-- transacción: o se compran todos o ninguno (si a mitad no llegan los puntos,
-- no se cobra nada). Por dentro llama a `buy_giveaway_ticket` (0024), así que
-- las reglas son las mismas: sorteo abierto, cuenta vinculada, +18, antigüedad
-- y un movimiento de puntos por ticket.
--
-- Mientras no esté aplicada, el servidor compra los tickets de uno en uno.

SET search_path TO public;

CREATE OR REPLACE FUNCTION buy_giveaway_tickets(p_user_id integer, p_giveaway_id integer, p_quantity integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_last jsonb;
  v_first integer;
  i integer;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 100 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  FOR i IN 1..p_quantity LOOP
    v_last := buy_giveaway_ticket(p_user_id, p_giveaway_id);
    IF v_first IS NULL THEN
      v_first := (v_last ->> 'entry_id')::integer;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'tickets', p_quantity,
    'first_entry_id', v_first,
    'entry_id', (v_last ->> 'entry_id')::integer,
    'giveaway_id', p_giveaway_id,
    'user_id', p_user_id,
    'balance', (v_last ->> 'balance')::integer
  );
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION buy_giveaway_tickets(integer, integer, integer) FROM PUBLIC;
  BEGIN
    REVOKE ALL ON FUNCTION buy_giveaway_tickets(integer, integer, integer) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION buy_giveaway_tickets(integer, integer, integer) TO service_role;
  EXCEPTION WHEN undefined_object THEN NULL; -- roles de Supabase ausentes
  END;
END $$;

NOTIFY pgrst, 'reload schema';
