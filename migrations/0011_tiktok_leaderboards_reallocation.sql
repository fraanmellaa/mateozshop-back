-- Reallocation tracking and richer leaderboard result stats

ALTER TABLE tiktok_leaderboards
ADD COLUMN IF NOT EXISTS has_reallocation BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE tiktok_leaderboards
ADD COLUMN IF NOT EXISTS reallocation_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE tiktok_leaderboard_results
ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE tiktok_leaderboard_results
ADD COLUMN IF NOT EXISTS comment_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE tiktok_leaderboard_results
ADD COLUMN IF NOT EXISTS share_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tiktok_leaderboards_reallocation
ON tiktok_leaderboards(has_reallocation, reallocation_count);
