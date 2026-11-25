-- 0046 · Límites de frecuencia compartidos entre instancias
--
-- Aplicar a mano en el SQL editor de Supabase. Se puede ejecutar más de una
-- vez. No cambia ninguna función ni tabla existente.
--
-- Para qué: el back corre en varias instancias y un contador en memoria no
-- basta para frenar un diccionario de contraseñas contra el login del panel o
-- un script que pide sin parar. `rate_limit_hit` cuenta las peticiones de una
-- clave (p. ej. «admin-login:IP» o «bid:usuario») en ventanas fijas y dice si
-- la petición cabe en el tope. Lo usa src/app/utils/rateLimit.ts.
--
-- Mientras esta migración no esté aplicada, el back sigue funcionando igual
-- (solo con el contador en memoria): no hay que coordinarla con ningún
-- despliegue.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS rate_limits (
  key text NOT NULL,
  window_start integer NOT NULL,            -- segundos Unix del inicio de la ventana
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits (window_start);

-- Apunta una petición y devuelve true si sigue dentro del tope.
CREATE OR REPLACE FUNCTION rate_limit_hit(p_key text, p_window integer, p_max integer) RETURNS boolean
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM clock_timestamp())::integer;
  v_start integer;
  v_hits integer;
BEGIN
  IF p_key IS NULL OR p_key = '' OR p_window IS NULL OR p_window <= 0 OR p_max IS NULL OR p_max <= 0 THEN
    RETURN true;
  END IF;
  v_start := v_now - (v_now % p_window);

  INSERT INTO rate_limits AS r (key, window_start, hits)
  VALUES (left(p_key, 200), v_start, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET hits = r.hits + 1
  RETURNING r.hits INTO v_hits;

  -- Limpieza de vez en cuando: fuera las ventanas de hace más de un día.
  IF random() < 0.02 THEN
    DELETE FROM rate_limits WHERE window_start < v_now - 86400;
  END IF;

  RETURN v_hits <= p_max;
END $$;

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  BEGIN
    GRANT ALL ON TABLE rate_limits TO service_role;
  EXCEPTION WHEN undefined_object THEN NULL; -- roles de Supabase ausentes
  END;
  REVOKE ALL ON FUNCTION rate_limit_hit(text, integer, integer) FROM PUBLIC;
  BEGIN
    REVOKE ALL ON FUNCTION rate_limit_hit(text, integer, integer) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION rate_limit_hit(text, integer, integer) TO service_role;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
