CREATE SCHEMA IF NOT EXISTS mateoz;
SET search_path TO mateoz, public;

CREATE TABLE IF NOT EXISTS "giveaways" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "giveaways_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cost" integer NOT NULL,
	"title" text NOT NULL,
	"image" text NOT NULL,
	"start_at" integer NOT NULL,
	"end_at" integer NOT NULL,
	"winner" integer,
	"codes" jsonb DEFAULT '[]' NOT NULL,
	"used_codes" jsonb DEFAULT '[]' NOT NULL,
	"sendable" boolean DEFAULT false NOT NULL,
	"comments" jsonb,
	"is_closed" boolean DEFAULT false NOT NULL
);
CREATE TABLE IF NOT EXISTS "giveaways_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "giveaways_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"giveaway_id" integer NOT NULL,
	"user_id" integer NOT NULL
);
CREATE TABLE IF NOT EXISTS "orders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"created_at" integer NOT NULL,
	"status" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL
);
CREATE TABLE IF NOT EXISTS "product_bids" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "product_bids_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"created_at" integer NOT NULL,
	"auction_round" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL
);
CREATE TABLE IF NOT EXISTS "products" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "products_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"image" text NOT NULL,
	"price" integer NOT NULL,
	"created_at" integer NOT NULL,
	"description" text NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"codes" jsonb DEFAULT '[]' NOT NULL,
	"used_codes" jsonb DEFAULT '[]' NOT NULL,
	"sendable" boolean DEFAULT false NOT NULL,
	"is_auction" boolean DEFAULT false NOT NULL,
	"min_bid_increment" integer DEFAULT 1 NOT NULL,
	"auction_ends_at" integer,
	"current_bid" integer DEFAULT 0 NOT NULL,
	"current_bidder_user_id" integer,
	"auction_duration_seconds" integer DEFAULT 3600 NOT NULL,
	"auction_cooldown_seconds" integer DEFAULT 300 NOT NULL,
	"auction_reopens_at" integer,
	"auction_round" integer DEFAULT 1 NOT NULL,
	"auction_status" text DEFAULT 'in_progress' NOT NULL,
	"auction_prize_assigned" boolean DEFAULT false NOT NULL,
	"auction_parent_product_id" integer,
	"auction_starting_notified" boolean DEFAULT false NOT NULL
);
CREATE TABLE IF NOT EXISTS "tiktok_leaderboard_prizes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tiktok_leaderboard_prizes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"leaderboard_id" integer NOT NULL,
	"position" integer NOT NULL,
	"reward" text NOT NULL,
	"created_at" integer NOT NULL
);
CREATE TABLE IF NOT EXISTS "tiktok_leaderboard_results" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tiktok_leaderboard_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"leaderboard_id" integer NOT NULL,
	"position" integer NOT NULL,
	"user_id" integer NOT NULL,
	"video_row_id" integer,
	"video_id" text NOT NULL,
	"video_title" text NOT NULL,
	"video_cover_image_url" text,
	"video_share_url" text,
	"view_count" integer DEFAULT 0 NOT NULL,
	"reward" text NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"review_note" text,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"share_count" integer DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS "tiktok_leaderboards" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tiktok_leaderboards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"description" text,
	"start_at" integer NOT NULL,
	"end_at" integer NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"finalized_at" integer,
	"review_notes" text,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL,
	"has_reallocation" boolean DEFAULT false NOT NULL,
	"reallocation_count" integer DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS "user_tiktok_accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_tiktok_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL CONSTRAINT "user_tiktok_accounts_user_id_key" UNIQUE,
	"open_id" text NOT NULL CONSTRAINT "user_tiktok_accounts_open_id_key" UNIQUE,
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
	"last_synced_at" integer
);
CREATE TABLE IF NOT EXISTS "user_tiktok_videos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_tiktok_videos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"video_id" text NOT NULL CONSTRAINT "user_tiktok_videos_video_id_key" UNIQUE,
	"title" text NOT NULL,
	"cover_image_url" text,
	"share_url" text,
	"like_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"share_count" integer DEFAULT 0 NOT NULL,
	"is_banned" boolean DEFAULT false NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL,
	"associated_at" integer NOT NULL
);
CREATE TABLE IF NOT EXISTS "users" (
	"id" integer GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"username" text NOT NULL CONSTRAINT "users_username_unique" UNIQUE,
	"kick_id" text,
	"image" text NOT NULL,
	"email" text NOT NULL CONSTRAINT "users_email_unique" UNIQUE,
	"total_points" integer DEFAULT 0 NOT NULL,
	"used_points" integer DEFAULT 0 NOT NULL,
	"created_at" integer NOT NULL,
	"discord_id" text NOT NULL,
	"verification_code" integer DEFAULT 1000 NOT NULL,
	"is_banned" boolean,
	"kick_username" text,
	CONSTRAINT "users_id_unique" PRIMARY KEY("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "giveaways_pkey" ON "giveaways" ("id");
CREATE INDEX IF NOT EXISTS "idx_giveaways_end_closed_winner" ON "giveaways" ("end_at","is_closed","winner");
CREATE UNIQUE INDEX IF NOT EXISTS "giveaways_entries_pkey" ON "giveaways_entries" ("id");
CREATE UNIQUE INDEX IF NOT EXISTS "orders_pkey" ON "orders" ("id");
CREATE INDEX IF NOT EXISTS "idx_product_bids_created_at" ON "product_bids" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_product_bids_product_id" ON "product_bids" ("product_id");
CREATE INDEX IF NOT EXISTS "idx_product_bids_product_round" ON "product_bids" ("product_id","auction_round");
CREATE INDEX IF NOT EXISTS "idx_product_bids_status" ON "product_bids" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "product_bids_pkey" ON "product_bids" ("id");
CREATE INDEX IF NOT EXISTS "idx_products_auction_parent_product_id" ON "products" ("auction_parent_product_id");
CREATE INDEX IF NOT EXISTS "idx_products_auction_reopens_at" ON "products" ("auction_reopens_at");
CREATE INDEX IF NOT EXISTS "idx_products_auction_status" ON "products" ("auction_status");
CREATE UNIQUE INDEX IF NOT EXISTS "products_pkey" ON "products" ("id");
CREATE INDEX IF NOT EXISTS "idx_tiktok_leaderboard_prizes_board_pos" ON "tiktok_leaderboard_prizes" ("leaderboard_id","position");
CREATE UNIQUE INDEX IF NOT EXISTS "tiktok_leaderboard_prizes_pkey" ON "tiktok_leaderboard_prizes" ("id");
CREATE INDEX IF NOT EXISTS "idx_tiktok_leaderboard_results_board_pos" ON "tiktok_leaderboard_results" ("leaderboard_id","position");
CREATE INDEX IF NOT EXISTS "idx_tiktok_leaderboard_results_status" ON "tiktok_leaderboard_results" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "tiktok_leaderboard_results_pkey" ON "tiktok_leaderboard_results" ("id");
CREATE INDEX IF NOT EXISTS "idx_tiktok_leaderboards_reallocation" ON "tiktok_leaderboards" ("has_reallocation","reallocation_count");
CREATE INDEX IF NOT EXISTS "idx_tiktok_leaderboards_time_status" ON "tiktok_leaderboards" ("start_at","end_at","status");
CREATE UNIQUE INDEX IF NOT EXISTS "tiktok_leaderboards_pkey" ON "tiktok_leaderboards" ("id");
CREATE INDEX IF NOT EXISTS "user_tiktok_accounts_open_id_idx" ON "user_tiktok_accounts" ("open_id");
CREATE UNIQUE INDEX IF NOT EXISTS "user_tiktok_accounts_open_id_key" ON "user_tiktok_accounts" ("open_id");
CREATE UNIQUE INDEX IF NOT EXISTS "user_tiktok_accounts_pkey" ON "user_tiktok_accounts" ("id");
CREATE INDEX IF NOT EXISTS "user_tiktok_accounts_user_id_idx" ON "user_tiktok_accounts" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "user_tiktok_accounts_user_id_key" ON "user_tiktok_accounts" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_tiktok_videos_associated_at" ON "user_tiktok_videos" ("associated_at");
CREATE INDEX IF NOT EXISTS "idx_tiktok_videos_associated_user" ON "user_tiktok_videos" ("user_id","associated_at");
CREATE INDEX IF NOT EXISTS "user_tiktok_videos_created_at_idx" ON "user_tiktok_videos" ("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "user_tiktok_videos_pkey" ON "user_tiktok_videos" ("id");
CREATE INDEX IF NOT EXISTS "user_tiktok_videos_user_id_idx" ON "user_tiktok_videos" ("user_id");
CREATE INDEX IF NOT EXISTS "user_tiktok_videos_video_id_idx" ON "user_tiktok_videos" ("video_id");
CREATE UNIQUE INDEX IF NOT EXISTS "user_tiktok_videos_video_id_key" ON "user_tiktok_videos" ("video_id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "users_id_unique" ON "users" ("id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_unique" ON "users" ("username");

DO $$ BEGIN
	ALTER TABLE "giveaways" ADD CONSTRAINT "giveaways_winner_users_id_fk" FOREIGN KEY ("winner") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "giveaways_entries" ADD CONSTRAINT "giveaways_entries_giveaway_id_giveaways_id_fk" FOREIGN KEY ("giveaway_id") REFERENCES "giveaways"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "giveaways_entries" ADD CONSTRAINT "giveaways_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "product_bids" ADD CONSTRAINT "product_bids_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "product_bids" ADD CONSTRAINT "product_bids_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "tiktok_leaderboard_prizes" ADD CONSTRAINT "tiktok_leaderboard_prizes_leaderboard_id_fkey" FOREIGN KEY ("leaderboard_id") REFERENCES "tiktok_leaderboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "tiktok_leaderboard_results" ADD CONSTRAINT "tiktok_leaderboard_results_leaderboard_id_fkey" FOREIGN KEY ("leaderboard_id") REFERENCES "tiktok_leaderboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "tiktok_leaderboard_results" ADD CONSTRAINT "tiktok_leaderboard_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "tiktok_leaderboard_results" ADD CONSTRAINT "tiktok_leaderboard_results_video_row_id_fkey" FOREIGN KEY ("video_row_id") REFERENCES "user_tiktok_videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "user_tiktok_accounts" ADD CONSTRAINT "user_tiktok_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "user_tiktok_videos" ADD CONSTRAINT "user_tiktok_videos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
