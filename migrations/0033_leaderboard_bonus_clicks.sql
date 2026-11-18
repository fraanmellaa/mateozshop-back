-- 0033: bonus del ranking mensual y clics de bonos (18 nov 2026).
--
-- Aplicar a mano en el SQL editor de Supabase DESPUÉS de la 0032. Es idempotente.
--
-- Qué hace:
--   · Bonus del ranking mensual: puesto 1 = 10.000 puntos, puestos 2 y 3 = 6.000,
--     puestos 4 a 10 = 3.000, y nada del 11 en adelante. Desaparece el
--     multiplicador «% por ver». El código ya trae esa escala por defecto; aquí
--     solo se pone al día lo que pudiera haber guardado en la base de datos.
--   · Contador de clics en «Conseguir bono» por bono y día (`bonus_click_stats`),
--     sin datos de quién hace clic: solo el número, para el panel.
--
-- No toca los juegos: no hay tope de puntos por jugada.

SET search_path TO public;

-- ───────────────────── bonus del ranking mensual ─────────────────────

-- Si el panel tiene guardada una escala antigua (alguna fila con «% por ver»),
-- se sustituye por la nueva. Una escala guardada sin porcentajes no se toca,
-- así que repetir la migración no pisa cambios hechos después desde el panel.
UPDATE app_settings
   SET value = jsonb_set(
         value,
         '{leaderboard,scale}',
         '[{"from": 1, "to": 1, "points": 10000, "multiplierPct": 0},
           {"from": 2, "to": 3, "points": 6000, "multiplierPct": 0},
           {"from": 4, "to": 10, "points": 3000, "multiplierPct": 0}]'::jsonb,
         true
       ),
       updated_at = extract(epoch FROM now())::integer
 WHERE key = 'economy'
   AND jsonb_typeof(value -> 'leaderboard' -> 'scale') = 'array'
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(value -> 'leaderboard' -> 'scale') AS step
      WHERE COALESCE((step ->> 'multiplierPct')::numeric, 0) > 0
   );

-- Los «% por ver» que estuvieran en vigor, o pendientes de darse, se quitan.
UPDATE user_month_bonus SET multiplier_pct = 0 WHERE multiplier_pct <> 0;
UPDATE monthly_leaderboard_results
   SET multiplier_pct = 0
 WHERE multiplier_pct <> 0 AND bonus_granted_at IS NULL;

-- ───────────────────── clics en «Conseguir bono» ─────────────────────
-- Un contador por bono y día (hora de Andorra). No guarda usuario, IP ni nada
-- que identifique a quien hace clic.

CREATE TABLE IF NOT EXISTS bonus_click_stats (
  bonus_id integer NOT NULL,
  day date NOT NULL,
  casino_name text NOT NULL DEFAULT '',  -- nombre del casino en el momento del clic
  clicks integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bonus_id, day)
);

-- Suma un clic al bono. Devuelve false si el bono no existe o no está activo.
CREATE OR REPLACE FUNCTION bonus_click(p_bonus_id integer) RETURNS boolean
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_name text;
  v_day date := (now() AT TIME ZONE 'Europe/Andorra')::date;
BEGIN
  SELECT casino_name INTO v_name FROM bonuses WHERE id = p_bonus_id AND is_active;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO bonus_click_stats (bonus_id, day, casino_name, clicks)
  VALUES (p_bonus_id, v_day, COALESCE(v_name, ''), 1)
  ON CONFLICT (bonus_id, day) DO UPDATE
    SET clicks = bonus_click_stats.clicks + 1, casino_name = EXCLUDED.casino_name;
  RETURN true;
END $$;

-- ───────────────────── permisos ─────────────────────

DO $$ BEGIN
  REVOKE ALL ON FUNCTION bonus_click(integer) FROM PUBLIC;
  BEGIN
    REVOKE ALL ON FUNCTION bonus_click(integer) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION bonus_click(integer) TO service_role;
  EXCEPTION WHEN undefined_object THEN NULL; -- roles de Supabase ausentes
  END;
END $$;

-- Solo el servidor (service_role) lee y escribe el contador.
ALTER TABLE bonus_click_stats ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  GRANT ALL ON TABLE bonus_click_stats TO service_role;
EXCEPTION WHEN undefined_object THEN NULL; -- rol de Supabase ausente
END $$;

NOTIFY pgrst, 'reload schema';
