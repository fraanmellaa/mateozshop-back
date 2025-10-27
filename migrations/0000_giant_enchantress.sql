CREATE TABLE "giveaways" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "giveaways_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cost" integer NOT NULL,
	"title" text NOT NULL,
	"image" text NOT NULL,
	"start_at" integer NOT NULL,
	"end_at" integer NOT NULL,
	"winner" integer,
	CONSTRAINT "giveaways_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "giveaways_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "giveaways_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"giveaway_id" integer NOT NULL,
	CONSTRAINT "giveaways_entries_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"status" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"created_at" integer NOT NULL,
	CONSTRAINT "orders_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "products_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"description" text NOT NULL,
	"image" text NOT NULL,
	"price" integer NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"codes" jsonb DEFAULT '[]' NOT NULL,
	"used_codes" jsonb DEFAULT '[]' NOT NULL,
	"sendable" boolean DEFAULT false NOT NULL,
	"created_at" integer NOT NULL,
	CONSTRAINT "products_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"username" text NOT NULL,
	"discord_id" text NOT NULL,
	"kick_id" text,
	"image" text NOT NULL,
	"email" text NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"used_points" integer DEFAULT 0 NOT NULL,
	"created_at" integer NOT NULL,
	"verification_code" integer DEFAULT 1000 NOT NULL,
	CONSTRAINT "users_id_unique" UNIQUE("id"),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_discord_id_unique" UNIQUE("discord_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "giveaways" ADD CONSTRAINT "giveaways_winner_users_id_fk" FOREIGN KEY ("winner") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "giveaways_entries" ADD CONSTRAINT "giveaways_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "giveaways_entries" ADD CONSTRAINT "giveaways_entries_giveaway_id_giveaways_id_fk" FOREIGN KEY ("giveaway_id") REFERENCES "public"."giveaways"("id") ON DELETE cascade ON UPDATE cascade;