CREATE TABLE IF NOT EXISTS "user_tiktok_videos" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "user_id" integer NOT NULL,
  "publish_id" text NOT NULL UNIQUE,
  "video_id" text UNIQUE,
  "title" text NOT NULL,
  "cover_image_url" text,
  "share_url" text,
  "like_count" integer NOT NULL DEFAULT 0,
  "view_count" integer NOT NULL DEFAULT 0,
  "comment_count" integer NOT NULL DEFAULT 0,
  "share_count" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'PROCESSING_UPLOAD',
  "fail_reason" text,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL,
  CONSTRAINT "user_tiktok_videos_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "user_tiktok_videos_user_id_idx"
  ON "user_tiktok_videos" ("user_id");

CREATE INDEX IF NOT EXISTS "user_tiktok_videos_created_at_idx"
  ON "user_tiktok_videos" ("created_at");

CREATE INDEX IF NOT EXISTS "user_tiktok_videos_video_id_idx"
  ON "user_tiktok_videos" ("video_id");