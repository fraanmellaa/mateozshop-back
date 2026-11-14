-- 0016: casinos y bonos de la página /bonuses (editables desde el panel).
--
-- Aplicar a mano en el SQL editor de Supabase. Es idempotente: se puede
-- ejecutar más de una vez (los 7 casinos iniciales solo se insertan si la
-- tabla está vacía).

SET search_path TO public;

CREATE TABLE IF NOT EXISTS bonuses (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  casino_name text NOT NULL,
  offer text NOT NULL,            -- texto del bono, p. ej. "30€ gratis + 200€"
  description text,               -- texto opcional bajo el bono
  image text,                     -- URL del logo (opcional)
  url text,                       -- enlace de afiliado; sin URL no se muestra el botón
  -- Segmentación por país (códigos ISO 3166-1 alfa-2 en mayúsculas, p. ej. ES).
  -- countries: lista blanca; vacía = todos los países.
  -- blocked_countries: lista negra, siempre tiene prioridad.
  -- Si no se puede determinar el país del visitante, solo se muestran los
  -- bonos con countries vacía.
  countries text[] NOT NULL DEFAULT '{}',
  blocked_countries text[] NOT NULL DEFAULT '{}',
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

-- Por si la tabla ya existía de una ejecución anterior sin estas columnas.
ALTER TABLE bonuses ADD COLUMN IF NOT EXISTS countries text[] NOT NULL DEFAULT '{}';
ALTER TABLE bonuses ADD COLUMN IF NOT EXISTS blocked_countries text[] NOT NULL DEFAULT '{}';

DO $$ BEGIN
  ALTER TABLE bonuses ADD CONSTRAINT bonuses_countries_valid
    CHECK (array_to_string(countries, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE bonuses ADD CONSTRAINT bonuses_blocked_countries_valid
    CHECK (array_to_string(blocked_countries, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_bonuses_active_position ON bonuses (is_active, position);

-- Casinos iniciales. Los enlaces de afiliado y los países se ajustan desde el
-- panel. Arrancan limitados a España (son ofertas en euros de marcas con
-- licencia española): hasta que añadas más países, solo se ven allí.
INSERT INTO bonuses (casino_name, offer, countries, position, created_at, updated_at)
SELECT v.casino_name, v.offer, ARRAY['ES']::text[], v.position,
       extract(epoch FROM now())::integer, extract(epoch FROM now())::integer
FROM (VALUES
  ('Casino Gran Madrid', '30€ gratis + 200€',    1),
  ('Casino Barcelona',   '30€ gratis + 200€',    2),
  ('Betfair',            '200 tiradas gratis',   3),
  ('DAZNBet',            '150€ gratis + 200€',   4),
  ('YoCasino',           '200€ + 50 tiradas',    5),
  ('Marathonbet',        '200€ + 50 giros',      6),
  ('Betway',             'hasta 150€',           7)
) AS v(casino_name, offer, position)
WHERE NOT EXISTS (SELECT 1 FROM bonuses);

-- Solo el back (service role) accede a la tabla.
ALTER TABLE bonuses ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  GRANT ALL ON TABLE bonuses TO service_role;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
