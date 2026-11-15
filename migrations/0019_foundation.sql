-- 0019: base común del nuevo sistema de puntos (encargo del 14 nov 2026).
--
-- Aplicar a mano en el SQL editor de Supabase DESPUÉS de la 0012 y antes de
-- las migraciones 0020 en adelante. Es idempotente.
--
-- Contiene solo lo que comparten varias piezas:
--   · helpers de tiempo (día y mes en hora de Andorra)
--   · columnas nuevas de users (Twitch, +18, enlace de Steam)
--   · estado del directo (sesiones y días con directo) y actividad en el chat
--   · minutos vistos por día
--   · semillas de aleatoriedad verificable (provably fair) por usuario

SET search_path TO public;

-- ───────────────────── tiempo (hora de Andorra) ─────────────────────
-- Todos los "día" y "mes" del sistema (racha, reinicio mensual, tope diario,
-- semana del torneo) se calculan en hora de Andorra, no en UTC.

CREATE OR REPLACE FUNCTION ad_day(ts integer) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (to_timestamp(ts) AT TIME ZONE 'Europe/Andorra')::date
$$;

CREATE OR REPLACE FUNCTION ad_month(ts integer) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT to_char(to_timestamp(ts) AT TIME ZONE 'Europe/Andorra', 'YYYY-MM')
$$;

-- ───────────────────────── users ─────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS twitch_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS twitch_username text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS twitch_created_at integer;   -- creación de la cuenta de Twitch (Helix la da)
ALTER TABLE users ADD COLUMN IF NOT EXISTS twitch_linked_at integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kick_linked_at integer;      -- Kick no expone la fecha de creación: se usa la de vinculación
ALTER TABLE users ADD COLUMN IF NOT EXISTS adult_confirmed_at integer;  -- confirmó ser mayor de 18 al iniciar sesión
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS steam_trade_url text;        -- enlace de intercambio de Steam (entrega de skins)

-- Una cuenta de Twitch solo puede estar vinculada a un usuario (como Kick).
CREATE UNIQUE INDEX IF NOT EXISTS users_twitch_id_unique
  ON users (twitch_id) WHERE twitch_id IS NOT NULL;

-- ───────────────── directo: sesiones y días con directo ─────────────────

CREATE TABLE IF NOT EXISTS stream_sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN ('kick', 'twitch')),
  started_at integer NOT NULL,
  ended_at integer,                 -- NULL = en directo ahora
  day date NOT NULL                 -- día (Andorra) en que empezó
);

-- Como mucho una sesión abierta por plataforma.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stream_sessions_open
  ON stream_sessions (platform) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_stream_sessions_day ON stream_sessions (day);

-- Días en los que hubo directo (en cualquier plataforma). La racha cuenta estos
-- días: un día sin directo no la rompe.
CREATE TABLE IF NOT EXISTS live_days (
  day date PRIMARY KEY,
  first_started_at integer NOT NULL
);

-- ───────────────────────── actividad en el chat ─────────────────────────
-- Una fila por usuario con su último mensaje válido (Kick o Twitch). Los
-- minutos solo puntúan si escribió en los últimos N minutos.

CREATE TABLE IF NOT EXISTS chat_activity (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_chat_at integer NOT NULL,    -- último mensaje que cuenta como actividad
  last_platform text,
  last_text_hash text,              -- hash del último texto (detectar repeticiones)
  last_text_at integer,
  repeat_count integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_chat_activity_last ON chat_activity (last_chat_at);

-- ───────────────────── minutos vistos por día ─────────────────────

CREATE TABLE IF NOT EXISTS user_watch_days (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL,                -- día (Andorra)
  minutes integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_user_watch_days_day ON user_watch_days (day);

-- ───────────────── aleatoriedad verificable (provably fair) ─────────────────
-- Una semilla de servidor por usuario (secreta; solo se publica su hash) y una
-- semilla de cliente que elige el usuario. Cada tirada usa un nonce nuevo.
-- Al rotar, se revela la semilla de servidor anterior para poder verificar.

CREATE TABLE IF NOT EXISTS fair_seeds (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  server_seed text NOT NULL,
  client_seed text NOT NULL,
  nonce bigint NOT NULL DEFAULT 0,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE IF NOT EXISTS fair_seed_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_seed text NOT NULL,
  server_seed_hash text NOT NULL,
  client_seed text NOT NULL,
  nonce_end bigint NOT NULL,        -- nonce con el que se cerró (nº de tiradas usadas)
  revealed_at integer NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fair_seed_history_user ON fair_seed_history (user_id, revealed_at DESC);

-- 64 caracteres hexadecimales aleatorios (sin depender de pgcrypto).
CREATE OR REPLACE FUNCTION fair_random_hex() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

CREATE OR REPLACE FUNCTION fair_hash(p_seed text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_seed, 'UTF8')), 'hex')
$$;

-- Crea las semillas del usuario si no existen.
CREATE OR REPLACE FUNCTION fair_ensure(p_user_id integer) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  INSERT INTO fair_seeds (user_id, server_seed, client_seed, nonce, created_at, updated_at)
  VALUES (p_user_id, fair_random_hex(), substr(fair_random_hex(), 1, 16), 0, v_now, v_now)
  ON CONFLICT (user_id) DO NOTHING;
END $$;

-- Estado público: hash de la semilla de servidor, semilla de cliente y nonce.
-- NUNCA devuelve la semilla de servidor.
CREATE OR REPLACE FUNCTION fair_state(p_user_id integer) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  s fair_seeds%ROWTYPE;
BEGIN
  PERFORM fair_ensure(p_user_id);
  SELECT * INTO s FROM fair_seeds WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'server_seed_hash', fair_hash(s.server_seed),
    'client_seed', s.client_seed,
    'nonce', s.nonce
  );
END $$;

-- Reserva `p_count` nonces de forma atómica y devuelve lo necesario para
-- calcular las tiradas EN EL SERVIDOR (incluye la semilla secreta: no debe
-- salir nunca en una respuesta HTTP). Dos peticiones simultáneas no pueden
-- recibir el mismo nonce.
CREATE OR REPLACE FUNCTION fair_reserve(p_user_id integer, p_count integer) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  s fair_seeds%ROWTYPE;
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  IF p_count IS NULL OR p_count < 1 OR p_count > 1000 THEN
    RAISE EXCEPTION 'INVALID_COUNT';
  END IF;

  PERFORM fair_ensure(p_user_id);
  SELECT * INTO s FROM fair_seeds WHERE user_id = p_user_id FOR UPDATE;

  UPDATE fair_seeds SET nonce = nonce + p_count, updated_at = v_now WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'server_seed', s.server_seed,
    'server_seed_hash', fair_hash(s.server_seed),
    'client_seed', s.client_seed,
    'nonce_start', s.nonce
  );
END $$;

-- Cambia la semilla de cliente (el nonce sigue contando con la misma semilla de servidor).
CREATE OR REPLACE FUNCTION fair_set_client_seed(p_user_id integer, p_client_seed text) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_now integer := extract(epoch FROM now())::integer;
BEGIN
  IF p_client_seed IS NULL OR p_client_seed !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'INVALID_CLIENT_SEED';
  END IF;

  PERFORM fair_ensure(p_user_id);
  UPDATE fair_seeds SET client_seed = p_client_seed, updated_at = v_now WHERE user_id = p_user_id;

  RETURN fair_state(p_user_id);
END $$;

-- Rota la semilla de servidor: revela la anterior (para que el usuario verifique
-- sus tiradas), crea una nueva y reinicia el nonce a 0.
CREATE OR REPLACE FUNCTION fair_rotate(p_user_id integer, p_client_seed text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  s fair_seeds%ROWTYPE;
  v_now integer := extract(epoch FROM now())::integer;
  v_new_server text := fair_random_hex();
  v_client text;
BEGIN
  IF p_client_seed IS NOT NULL AND p_client_seed !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'INVALID_CLIENT_SEED';
  END IF;

  PERFORM fair_ensure(p_user_id);
  SELECT * INTO s FROM fair_seeds WHERE user_id = p_user_id FOR UPDATE;

  INSERT INTO fair_seed_history (user_id, server_seed, server_seed_hash, client_seed, nonce_end, revealed_at)
  VALUES (p_user_id, s.server_seed, fair_hash(s.server_seed), s.client_seed, s.nonce, v_now);

  v_client := COALESCE(p_client_seed, s.client_seed);

  UPDATE fair_seeds
     SET server_seed = v_new_server, client_seed = v_client, nonce = 0, updated_at = v_now
   WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'revealed', jsonb_build_object(
      'server_seed', s.server_seed,
      'server_seed_hash', fair_hash(s.server_seed),
      'client_seed', s.client_seed,
      'nonce_end', s.nonce
    ),
    'current', jsonb_build_object(
      'server_seed_hash', fair_hash(v_new_server),
      'client_seed', v_client,
      'nonce', 0
    )
  );
END $$;

-- ───────────────────── permisos ─────────────────────
-- Solo el service role (el back) ejecuta las funciones y lee las tablas.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'ad_day(integer)',
    'ad_month(integer)',
    'fair_random_hex()',
    'fair_hash(text)',
    'fair_ensure(integer)',
    'fair_state(integer)',
    'fair_reserve(integer, integer)',
    'fair_set_client_seed(integer, text)',
    'fair_rotate(integer, text)'
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
  FOREACH t IN ARRAY ARRAY[
    'stream_sessions', 'live_days', 'chat_activity', 'user_watch_days',
    'fair_seeds', 'fair_seed_history'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('GRANT ALL ON TABLE %I TO service_role', t);
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
