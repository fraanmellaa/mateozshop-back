-- 0036: varias solicitudes de verificación a la vez (18 nov 2026).
--
-- Aplicar a mano en el SQL editor de Supabase DESPUÉS de la 0032. Es idempotente.
--
-- Hasta ahora un usuario solo podía tener UNA solicitud en revisión. Ahora
-- puede tener una por casino: mientras se revisa la de un casino puede enviar
-- la de otro. Sigue sin poder repetir un casino que ya tiene en revisión o
-- aprobado, y un usuario de casino sigue valiendo para una sola cuenta.
--
-- verification_request es la misma función de la 0032 con ese único cambio:
-- REQUEST_PENDING pasa a significar «ya tienes una solicitud en revisión para
-- ese casino». Si se reejecuta la 0032, reejecutar después esta.

SET search_path TO public;

-- El tope pasa de «una pendiente por usuario» a «una pendiente por usuario y casino».
DROP INDEX IF EXISTS uq_verification_requests_pending;
CREATE UNIQUE INDEX IF NOT EXISTS uq_verification_requests_pending_casino
  ON verification_requests (user_id, lower(casino)) WHERE status = 'pending';

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
  -- Una solicitud en revisión por casino (antes: una en total).
  IF EXISTS (SELECT 1 FROM verification_requests
              WHERE user_id = p_user_id AND status = 'pending' AND lower(casino) = lower(v_casino)) THEN
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

DO $$ BEGIN
  REVOKE ALL ON FUNCTION verification_request(integer, text, text, text, text) FROM PUBLIC;
  BEGIN
    REVOKE ALL ON FUNCTION verification_request(integer, text, text, text, text) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION verification_request(integer, text, text, text, text) TO service_role;
  EXCEPTION WHEN undefined_object THEN NULL; -- roles de Supabase ausentes
  END;
END $$;

NOTIFY pgrst, 'reload schema';
