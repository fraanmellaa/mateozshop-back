-- 0041 · Depósito mínimo para verificarse, distinto por casino
--
-- Cada casino de Bonos tiene su «depósito mínimo para verificar» (en euros):
-- 30 por defecto y 50 en Casino Gran Madrid. Lo editan desde el panel de Bonos
-- y lo leen los textos de la web (/bonuses, /verificate, portada, tienda,
-- preguntas frecuentes y bases) y el panel de Verificaciones.
--
-- Se puede ejecutar más de una vez sin efectos.

SET search_path TO public;

ALTER TABLE bonuses
  ADD COLUMN IF NOT EXISTS verify_min_deposit integer NOT NULL DEFAULT 30;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bonuses_verify_min_deposit_check'
  ) THEN
    ALTER TABLE bonuses
      ADD CONSTRAINT bonuses_verify_min_deposit_check
      CHECK (verify_min_deposit BETWEEN 1 AND 10000);
  END IF;
END $$;

-- Casino Gran Madrid pide 50 € (solo si sigue con el valor por defecto).
UPDATE bonuses
   SET verify_min_deposit = 50
 WHERE lower(btrim(casino_name)) = 'casino gran madrid'
   AND verify_min_deposit = 30;
