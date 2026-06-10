-- TikTok leaderboards with configurable prizes and manual review lifecycle

ALTER TABLE user_tiktok_videos
ADD COLUMN IF NOT EXISTS associated_at INTEGER;

UPDATE user_tiktok_videos
SET associated_at = COALESCE(associated_at, created_at)
WHERE associated_at IS NULL;

ALTER TABLE user_tiktok_videos
ALTER COLUMN associated_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS tiktok_leaderboards (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  finalized_at INTEGER,
  review_notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tiktok_leaderboard_prizes (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  leaderboard_id INTEGER NOT NULL REFERENCES tiktok_leaderboards(id) ON UPDATE CASCADE ON DELETE CASCADE,
  position INTEGER NOT NULL,
  reward TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tiktok_leaderboard_results (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  leaderboard_id INTEGER NOT NULL REFERENCES tiktok_leaderboards(id) ON UPDATE CASCADE ON DELETE CASCADE,
  position INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  video_row_id INTEGER REFERENCES user_tiktok_videos(id) ON UPDATE CASCADE ON DELETE SET NULL,
  video_id TEXT NOT NULL,
  video_title TEXT NOT NULL,
  video_cover_image_url TEXT,
  video_share_url TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  reward TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  review_note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tiktok_videos_associated_at ON user_tiktok_videos(associated_at);
CREATE INDEX IF NOT EXISTS idx_tiktok_videos_associated_user ON user_tiktok_videos(user_id, associated_at);
CREATE INDEX IF NOT EXISTS idx_tiktok_leaderboards_time_status ON tiktok_leaderboards(start_at, end_at, status);
CREATE INDEX IF NOT EXISTS idx_tiktok_leaderboard_prizes_board_pos ON tiktok_leaderboard_prizes(leaderboard_id, position);
CREATE INDEX IF NOT EXISTS idx_tiktok_leaderboard_results_board_pos ON tiktok_leaderboard_results(leaderboard_id, position);
CREATE INDEX IF NOT EXISTS idx_tiktok_leaderboard_results_status ON tiktok_leaderboard_results(status);
