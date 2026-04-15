CREATE TABLE IF NOT EXISTS "user_tiktok_accounts" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "user_id" integer NOT NULL UNIQUE,
  "open_id" text NOT NULL UNIQUE,
  "union_id" text,
  "display_name" text,
  "username" text,
  "avatar_url" text,
  "profile_deep_link" text,
  "scope" text NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text NOT NULL,
  "access_token_expires_at" integer NOT NULL,
  "refresh_token_expires_at" integer NOT NULL,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL,
  "last_synced_at" integer,
  CONSTRAINT "user_tiktok_accounts_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "user_tiktok_accounts_user_id_idx"
  ON "user_tiktok_accounts" ("user_id");

CREATE INDEX IF NOT EXISTS "user_tiktok_accounts_open_id_idx"
  ON "user_tiktok_accounts" ("open_id");
