-- Mark giveaways as closed even when there is no winner

ALTER TABLE giveaways
ADD COLUMN IF NOT EXISTS is_closed BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_giveaways_end_closed_winner
ON giveaways(end_at, is_closed, winner);
