ALTER TABLE "giveaways" ADD COLUMN "codes" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "giveaways" ADD COLUMN "used_codes" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "giveaways" ADD COLUMN "sendable" boolean DEFAULT false NOT NULL;