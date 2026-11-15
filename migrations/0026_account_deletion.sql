-- 0026: baja de cuenta (derecho de supresión de la política de privacidad).
--
-- Aplicar a mano en el SQL editor de Supabase DESPUÉS de la 0021 (borra filas
-- de tablas que crea la 0019). Es idempotente.
--
-- La baja ANONIMIZA al usuario en el acto (la política promete "eliminan o
-- anonimizan en un plazo de 30 días"): la fila de `users` se conserva sin
-- ningún dato personal para no romper pedidos, premios entregados ni el
-- registro de movimientos, que se conservan durante los plazos legales. Se
-- borran las conexiones de TikTok (con sus tokens), la actividad en el chat,
-- los minutos vistos y las semillas verificables. Los puntos se ponen a 0 y
-- los tickets de sorteos abiertos se pierden.
--
-- No se puede dar de baja con pujas activas, pedidos pendientes de entrega ni
-- premios de cajas por entregar: hay que esperar a que terminen.

SET search_path TO public;

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at integer;

CREATE OR REPLACE FUNCTION user_delete_account(p_user_id integer) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  u users%ROWTYPE;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  SELECT * INTO u FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  IF u.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('deleted', true, 'already', true);
  END IF;

  IF EXISTS (
    SELECT 1 FROM products
     WHERE current_bidder_user_id = p_user_id
       AND auction_status IN ('in_progress', 'finalizing')
  ) THEN
    RAISE EXCEPTION 'ACTIVE_BIDS';
  END IF;

  IF EXISTS (SELECT 1 FROM orders WHERE user_id = p_user_id AND status = 0) THEN
    RAISE EXCEPTION 'PENDING_ORDERS';
  END IF;

  IF EXISTS (SELECT 1 FROM loot_box_openings WHERE user_id = p_user_id AND status = 'pending') THEN
    RAISE EXCEPTION 'PENDING_PRIZES';
  END IF;

  -- Tickets de sorteos que aún no se han sorteado: se pierden.
  DELETE FROM giveaways_entries
   WHERE user_id = p_user_id
     AND giveaway_id IN (SELECT id FROM giveaways WHERE winner IS NULL AND is_closed = false);

  -- Saldo a cero con su movimiento en el libro (nadie escribe puntos a mano).
  PERFORM points_reset(p_user_id);

  DELETE FROM user_tiktok_accounts WHERE user_id = p_user_id;
  DELETE FROM chat_activity WHERE user_id = p_user_id;
  DELETE FROM user_watch_days WHERE user_id = p_user_id;
  DELETE FROM fair_seeds WHERE user_id = p_user_id;
  DELETE FROM fair_seed_history WHERE user_id = p_user_id;

  UPDATE users
     SET username = 'eliminado-' || id,
         email = 'eliminado-' || id || '@eliminado.invalid',
         image = '',
         discord_id = 'eliminado-' || id,
         kick_id = NULL,
         kick_username = NULL,
         kick_linked_at = NULL,
         twitch_id = NULL,
         twitch_username = NULL,
         twitch_created_at = NULL,
         twitch_linked_at = NULL,
         steam_trade_url = NULL,
         adult_confirmed_at = NULL,
         terms_accepted_at = NULL,
         deleted_at = v_now
   WHERE id = p_user_id;

  RETURN jsonb_build_object('deleted', true, 'already', false);
END $$;

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION user_delete_account(integer) FROM PUBLIC';
  BEGIN
    EXECUTE 'REVOKE ALL ON FUNCTION user_delete_account(integer) FROM anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION user_delete_account(integer) TO service_role';
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
