-- 0027: novedades (noticias y avisos que el admin publica desde el panel y se
-- ven en la web pública, /novedades).
--
-- Aplicar a mano en el SQL editor de Supabase. Es idempotente.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS news (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL CHECK (char_length(btrim(title)) > 0),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),  -- lo genera el back a partir del título
  summary text,                           -- texto corto para las tarjetas
  body text NOT NULL DEFAULT '',          -- texto plano; el front lo escapa al pintar (pre-wrap)
  image text CHECK (image IS NULL OR image ~ '^https://'),
  tag text,                               -- "Evento", "Tienda", "Aviso"...
  link_url text CHECK (link_url IS NULL OR link_url ~ '^(https?://|/([^/\\]|$))'),  -- botón: http(s) o ruta interna
  link_text text,
  pinned boolean NOT NULL DEFAULT false,
  is_published boolean NOT NULL DEFAULT false,
  published_at integer,                   -- segundos Unix, como el resto de tablas
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_news_slug ON news (slug);
-- Listado público: publicadas, fijadas primero y luego por fecha.
CREATE INDEX IF NOT EXISTS idx_news_published
  ON news (is_published, pinned DESC, published_at DESC, id DESC);

-- Solo el back (service_role) toca la tabla: RLS sin políticas y sin permisos
-- para los roles públicos de Supabase.
ALTER TABLE news ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  REVOKE ALL ON TABLE news FROM anon, authenticated;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  GRANT ALL ON TABLE news TO service_role;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
