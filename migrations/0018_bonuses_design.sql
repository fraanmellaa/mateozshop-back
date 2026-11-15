-- 0018: diseño de los bonos (color del casino, texto del botón) y bucket de logos.
--
-- Aplicar a mano en el SQL editor de Supabase. Es idempotente.

SET search_path TO public;

-- Color de acento del casino (#RRGGBB) o NULL = estilo por defecto.
ALTER TABLE bonuses ADD COLUMN IF NOT EXISTS color text;
-- Texto del botón; NULL = "Reclamar bono".
ALTER TABLE bonuses ADD COLUMN IF NOT EXISTS button_text text;

DO $$ BEGIN
  ALTER TABLE bonuses ADD CONSTRAINT bonuses_color_valid
    CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bucket público para los logos. Solo el back (service role) escribe; la
-- lectura pública la da public = true (sin políticas de escritura).
INSERT INTO storage.buckets (id, name, public)
VALUES ('bonus-logos', 'bonus-logos', true)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
