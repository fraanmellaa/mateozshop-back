-- 0015: reglas del concurso de TikTok, finalización idempotente y
-- reasignación real de premios.
--
-- Aplicar a mano en el SQL editor de Supabase (es idempotente: se puede
-- ejecutar más de una vez). El código del back depende de estas columnas.

SET search_path TO public;

-- ───────────────────── user_tiktok_videos ─────────────────────

-- Existe en la BD real pero no estaba en ninguna migración del repo.
ALTER TABLE user_tiktok_videos ADD COLUMN IF NOT EXISTS leaderboard_id integer;

DO $$ BEGIN
  ALTER TABLE user_tiktok_videos ADD CONSTRAINT user_tiktok_videos_leaderboard_id_fkey
    FOREIGN KEY (leaderboard_id) REFERENCES tiktok_leaderboards(id)
    ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_tiktok_videos_leaderboard
  ON user_tiktok_videos (leaderboard_id, view_count DESC);

-- Último refresco de contadores con éxito (segundos).
ALTER TABLE user_tiktok_videos ADD COLUMN IF NOT EXISTS last_refreshed_at integer;
-- Refrescos consecutivos en los que TikTok no ha devuelto el vídeo.
ALTER TABLE user_tiktok_videos ADD COLUMN IF NOT EXISTS refresh_failures integer NOT NULL DEFAULT 0;
-- Si no es NULL, el vídeo se da por borrado/privado y deja de contar.
ALTER TABLE user_tiktok_videos ADD COLUMN IF NOT EXISTS unavailable_at integer;
-- Cuenta de TikTok (open_id) con la que se verificó la propiedad.
ALTER TABLE user_tiktok_videos ADD COLUMN IF NOT EXISTS tiktok_open_id text;

-- ───────────────────── user_tiktok_accounts ─────────────────────

-- El refresh token caducó o TikTok lo rechazó: el usuario debe volver a vincular.
ALTER TABLE user_tiktok_accounts ADD COLUMN IF NOT EXISTS needs_relink boolean NOT NULL DEFAULT false;

-- ───────────────────── tiktok_leaderboard_results ─────────────────────

-- El snapshot final guarda el ranking elegible completo: los puestos sin premio
-- son suplentes (status 'substitute', reward NULL). Un resultado descalificado
-- pierde su puesto (position NULL) y conserva el que tenía en original_position.
ALTER TABLE tiktok_leaderboard_results ALTER COLUMN position DROP NOT NULL;
ALTER TABLE tiktok_leaderboard_results ALTER COLUMN reward DROP NOT NULL;
ALTER TABLE tiktok_leaderboard_results ADD COLUMN IF NOT EXISTS original_position integer;
-- El aviso de ganador (email + notificación) se envía una sola vez por puesto.
ALTER TABLE tiktok_leaderboard_results ADD COLUMN IF NOT EXISTS winner_notified_at integer;

-- Restos de finalizaciones duplicadas anteriores: se conserva la fila más antigua
-- de cada puesto para poder crear el índice único.
DELETE FROM tiktok_leaderboard_results a
  USING tiktok_leaderboard_results b
  WHERE a.leaderboard_id = b.leaderboard_id
    AND a.position = b.position
    AND a.id > b.id;

-- Un puesto, un resultado. Los descalificados (position NULL) no chocan.
CREATE UNIQUE INDEX IF NOT EXISTS tiktok_leaderboard_results_board_position_unique
  ON tiktok_leaderboard_results (leaderboard_id, position);

-- Estados de tiktok_leaderboards.status (texto libre, sin CHECK):
--   scheduled → active → finalizing → in_review → closed, y cancelled.
-- 'finalizing' es nuevo: la leaderboard ha terminado y se están refrescando los
-- contadores antes de guardar el snapshot final.
