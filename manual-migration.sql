-- Script de migración manual para agregar columnas faltantes
-- Ejecuta este script directamente en tu consola de base de datos de Neon

-- 1. Verificar estructura actual
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'giveaways' 
ORDER BY ordinal_position;

-- 2. Agregar columna sendable si no existe
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'giveaways' AND column_name = 'sendable'
    ) THEN
        ALTER TABLE giveaways ADD COLUMN sendable BOOLEAN NOT NULL DEFAULT false;
        RAISE NOTICE 'Columna sendable agregada';
    ELSE
        RAISE NOTICE 'Columna sendable ya existe';
    END IF;
END $$;

-- 3. Agregar columna codes si no existe
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'giveaways' AND column_name = 'codes'
    ) THEN
        ALTER TABLE giveaways ADD COLUMN codes JSONB NOT NULL DEFAULT '[]'::jsonb;
        RAISE NOTICE 'Columna codes agregada';
    ELSE
        RAISE NOTICE 'Columna codes ya existe';
    END IF;
END $$;

-- 4. Agregar columna used_codes si no existe
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'giveaways' AND column_name = 'used_codes'
    ) THEN
        ALTER TABLE giveaways ADD COLUMN used_codes JSONB NOT NULL DEFAULT '[]'::jsonb;
        RAISE NOTICE 'Columna used_codes agregada';
    ELSE
        RAISE NOTICE 'Columna used_codes ya existe';
    END IF;
END $$;

-- 5. Verificar la estructura final
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'giveaways' 
ORDER BY ordinal_position;

-- 6. Probar una consulta con los nuevos campos
SELECT id, title, sendable, codes, used_codes 
FROM giveaways 
LIMIT 3;