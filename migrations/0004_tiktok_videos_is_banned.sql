ALTER TABLE "user_tiktok_videos"
ADD COLUMN IF NOT EXISTS "is_banned" boolean NOT NULL DEFAULT false;