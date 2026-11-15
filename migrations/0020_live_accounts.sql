-- 0020: directo (Kick + Twitch), lectura del chat por webhooks y conexiones del streamer.
--
-- Aplicar a mano en el SQL editor de Supabase DESPUÉS de la 0019. Es idempotente.
--
-- Contiene:
--   · streamer_connections: tokens OAuth del streamer por plataforma y estado de sus suscripciones
--   · live_state: lecturas fallidas/negativas consecutivas por plataforma (histéresis al cerrar un directo)
--   · webhook_events: ids de mensajes de webhook ya procesados (deduplicado) con limpieza
--   · claim_webhook_event(): registra un id de forma atómica
--   · chat_register_message(): aplica las reglas anti-farmeo de forma atómica

SET search_path TO public;

-- Los usuarios que ya tenían Kick vinculado antes de esta migración cuentan como
-- vinculados desde que se registraron (no hay fecha real de creación de la
-- cuenta de Kick). Así la antigüedad mínima no deja fuera a toda la base actual.
UPDATE users
   SET kick_linked_at = COALESCE(created_at, extract(epoch FROM now())::integer)
 WHERE kick_id IS NOT NULL AND kick_linked_at IS NULL;

-- ───────────────────── conexiones del streamer ─────────────────────
-- Los tokens se guardan en claro (como los de TikTok): la tabla tiene RLS sin
-- políticas, solo el service role (el back) la lee. Nunca se devuelven al panel.

CREATE TABLE IF NOT EXISTS streamer_connections (
  platform text PRIMARY KEY CHECK (platform IN ('kick', 'twitch')),
  platform_user_id text NOT NULL,
  platform_username text,
  access_token text NOT NULL,
  refresh_token text,
  expires_at integer,                         -- caducidad del access_token (segundos Unix)
  scopes text,
  subscriptions jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{type, id, status, error, updated_at}]
  subscriptions_checked_at integer,
  last_error text,
  connected_at integer NOT NULL,
  updated_at integer NOT NULL
);

-- ───────────────────── estado de lectura del directo ─────────────────────

CREATE TABLE IF NOT EXISTS live_state (
  platform text PRIMARY KEY CHECK (platform IN ('kick', 'twitch')),
  misses integer NOT NULL DEFAULT 0,          -- lecturas "no está en directo" seguidas con sesión abierta
  last_ok_at integer,                         -- última lectura correcta
  last_error text,
  last_error_at integer
);

-- ───────────────────── webhooks procesados ─────────────────────

CREATE TABLE IF NOT EXISTS webhook_events (
  platform text NOT NULL,
  event_id text NOT NULL,
  received_at integer NOT NULL,
  PRIMARY KEY (platform, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received ON webhook_events (received_at);

-- Registra el id de un mensaje de webhook. Devuelve true si es la primera vez
-- (hay que procesarlo) y false si ya estaba (duplicado). Borra de vez en cuando
-- los ids de más de un día: ninguna plataforma reenvía mensajes tan antiguos y
-- el webhook ya descarta los de más de unos minutos.
CREATE OR REPLACE FUNCTION claim_webhook_event(p_platform text, p_event_id text) RETURNS boolean
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
  v_rows integer;
BEGIN
  INSERT INTO webhook_events (platform, event_id, received_at)
  VALUES (p_platform, p_event_id, v_now)
  ON CONFLICT (platform, event_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF random() < 0.01 THEN
    DELETE FROM webhook_events WHERE received_at < v_now - 86400;
  END IF;

  RETURN v_rows > 0;
END $$;

-- ───────────────────── actividad en el chat (anti-farmeo) ─────────────────────
-- p_valid: el texto ya pasó las comprobaciones de contenido (longitud y variedad
-- de caracteres), que se hacen en el servidor. Aquí se aplican las que dependen
-- del historial del usuario, bajo bloqueo de fila para que dos mensajes
-- simultáneos no cuenten los dos:
--   · no repetir el mismo texto que el último mensaje contado en p_repeat_window s
--   · como mucho un mensaje contado cada p_min_gap s
-- Devuelve true si el mensaje cuenta como actividad.

CREATE OR REPLACE FUNCTION chat_register_message(
  p_user_id integer,
  p_platform text,
  p_text_hash text,
  p_valid boolean,
  p_now integer,
  p_min_gap integer,
  p_repeat_window integer
) RETURNS boolean
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  a chat_activity%ROWTYPE;
BEGIN
  IF NOT p_valid THEN
    RETURN false;
  END IF;

  -- Crea la fila si no existe (last_chat_at = 0: nunca ha contado) y la bloquea.
  INSERT INTO chat_activity (user_id, last_chat_at, last_platform, last_text_hash, last_text_at, repeat_count)
  VALUES (p_user_id, 0, p_platform, NULL, NULL, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO a FROM chat_activity WHERE user_id = p_user_id FOR UPDATE;

  IF p_now - a.last_chat_at < p_min_gap THEN
    RETURN false;
  END IF;

  IF a.last_text_hash IS NOT NULL
     AND a.last_text_hash = p_text_hash
     AND a.last_text_at IS NOT NULL
     AND p_now - a.last_text_at < p_repeat_window THEN
    UPDATE chat_activity SET repeat_count = repeat_count + 1 WHERE user_id = p_user_id;
    RETURN false;
  END IF;

  UPDATE chat_activity
     SET last_chat_at = p_now,
         last_platform = p_platform,
         last_text_hash = p_text_hash,
         last_text_at = p_now,
         repeat_count = 0
   WHERE user_id = p_user_id;

  RETURN true;
END $$;

-- ───────────────────── permisos ─────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'claim_webhook_event(text, text)',
    'chat_register_message(integer, text, text, boolean, integer, integer, integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['streamer_connections', 'live_state', 'webhook_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('GRANT ALL ON TABLE %I TO service_role', t);
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
