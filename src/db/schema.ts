import { integer, text, pgTable, jsonb, boolean } from "drizzle-orm/pg-core";

/*
  npx drizzle-kit generate   
  npx drizzle-kit push
*/

export const users = pgTable("users", {
  id: integer("id").primaryKey().unique().generatedAlwaysAsIdentity(),
  username: text("username").notNull().unique(),
  discord_id: text("discord_id").notNull().unique(),
  kick_id: text("kick_id"),
  image: text("image").notNull(),
  email: text("email").notNull().unique(),
  kick_username: text("kick_username").unique(),
  total_points: integer("total_points").notNull().default(0),
  used_points: integer("used_points").notNull().default(0),
  created_at: integer("created_at").notNull(),
  verification_code: integer("verification_code").notNull().default(1000),
});

export const products = pgTable("products", {
  id: integer("id").primaryKey().unique().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  image: text("image").notNull(),
  price: integer("price").notNull(),
  stock: integer("stock").notNull().default(0),
  is_auction: boolean("is_auction").notNull().default(false),
  min_bid_increment: integer("min_bid_increment").notNull().default(1),
  auction_ends_at: integer("auction_ends_at"),
  auction_duration_seconds: integer("auction_duration_seconds")
    .notNull()
    .default(3600),
  auction_cooldown_seconds: integer("auction_cooldown_seconds")
    .notNull()
    .default(300),
  auction_parent_product_id: integer("auction_parent_product_id"),
  auction_starting_notified: boolean("auction_starting_notified")
    .notNull()
    .default(false),
  auction_reopens_at: integer("auction_reopens_at"),
  auction_round: integer("auction_round").notNull().default(1),
  auction_status: text("auction_status").notNull().default("in_progress"),
  auction_prize_assigned: boolean("auction_prize_assigned")
    .notNull()
    .default(false),
  current_bid: integer("current_bid").notNull().default(0),
  current_bidder_user_id: integer("current_bidder_user_id"),
  codes: jsonb("codes").notNull().default("[]").$type<string[]>(),
  used_codes: jsonb("used_codes").notNull().default("[]").$type<string[]>(),
  sendable: boolean("sendable").notNull().default(false),
  created_at: integer("created_at").notNull(),
});

export const product_bids = pgTable("product_bids", {
  id: integer("id").primaryKey().unique().generatedAlwaysAsIdentity(),
  product_id: integer("product_id")
    .notNull()
    .references(() => products.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  user_id: integer("user_id")
    .notNull()
    .references(() => users.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  amount: integer("amount").notNull(),
  auction_round: integer("auction_round").notNull().default(1),
  status: text("status").notNull().default("in_progress"),
  created_at: integer("created_at").notNull(),
});

export const orders = pgTable("orders", {
  id: integer("id").primaryKey().unique().generatedAlwaysAsIdentity(),
  user_id: integer("user_id").notNull(),
  product_id: integer("product_id").notNull(),
  status: integer("status").notNull().default(0), // 0: pending, 1: completed, 2: cancelled
  total: integer("total").notNull(),
  created_at: integer("created_at").notNull(),
});

export const giveaways = pgTable("giveaways", {
  id: integer("id").primaryKey().unique().generatedAlwaysAsIdentity(),
  cost: integer("cost").notNull(),
  title: text("title").notNull(),
  image: text("image").notNull(),
  start_at: integer("start_at").notNull(),
  end_at: integer("end_at").notNull(),
  is_closed: boolean("is_closed").notNull().default(false),
  winner: integer("winner").references(() => users.id, {
    onDelete: "set null",
    onUpdate: "cascade",
  }),
  comments: jsonb("comments").notNull().default("[]").$type<
    Array<{
      created_at: number;
      message: string;
    }>
  >(),
});

export const giveaways_entries = pgTable("giveaways_entries", {
  id: integer("id").primaryKey().unique().generatedAlwaysAsIdentity(),
  user_id: integer("user_id")
    .notNull()
    .references(() => users.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  giveaway_id: integer("giveaway_id")
    .notNull()
    .references(() => giveaways.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
});

export const user_tiktok_accounts = pgTable("user_tiktok_accounts", {
  id: integer("id").primaryKey().unique().generatedAlwaysAsIdentity(),
  user_id: integer("user_id")
    .notNull()
    .unique()
    .references(() => users.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  open_id: text("open_id").notNull().unique(),
  union_id: text("union_id"),
  display_name: text("display_name"),
  username: text("username"),
  avatar_url: text("avatar_url"),
  profile_deep_link: text("profile_deep_link"),
  scope: text("scope").notNull(),
  access_token: text("access_token").notNull(),
  refresh_token: text("refresh_token").notNull(),
  access_token_expires_at: integer("access_token_expires_at").notNull(),
  refresh_token_expires_at: integer("refresh_token_expires_at").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
  last_synced_at: integer("last_synced_at"),
});

export const user_tiktok_videos = pgTable("user_tiktok_videos", {
  id: integer("id").primaryKey().unique().generatedAlwaysAsIdentity(),
  user_id: integer("user_id")
    .notNull()
    .references(() => users.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  video_id: text("video_id").notNull().unique(),
  title: text("title").notNull(),
  cover_image_url: text("cover_image_url"),
  share_url: text("share_url"),
  like_count: integer("like_count").notNull().default(0),
  view_count: integer("view_count").notNull().default(0),
  comment_count: integer("comment_count").notNull().default(0),
  share_count: integer("share_count").notNull().default(0),
  is_banned: boolean("is_banned").notNull().default(false),
  associated_at: integer("associated_at").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const tiktok_leaderboards = pgTable("tiktok_leaderboards", {
  id: integer("id").primaryKey().unique().generatedAlwaysAsIdentity(),
  title: text("title").notNull(),
  description: text("description"),
  start_at: integer("start_at").notNull(),
  end_at: integer("end_at").notNull(),
  status: text("status").notNull().default("scheduled"),
  finalized_at: integer("finalized_at"),
  has_reallocation: boolean("has_reallocation").notNull().default(false),
  reallocation_count: integer("reallocation_count").notNull().default(0),
  review_notes: text("review_notes"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const tiktok_leaderboard_prizes = pgTable("tiktok_leaderboard_prizes", {
  id: integer("id").primaryKey().unique().generatedAlwaysAsIdentity(),
  leaderboard_id: integer("leaderboard_id")
    .notNull()
    .references(() => tiktok_leaderboards.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  position: integer("position").notNull(),
  reward: text("reward").notNull(),
  created_at: integer("created_at").notNull(),
});

export const tiktok_leaderboard_results = pgTable("tiktok_leaderboard_results", {
  id: integer("id").primaryKey().unique().generatedAlwaysAsIdentity(),
  leaderboard_id: integer("leaderboard_id")
    .notNull()
    .references(() => tiktok_leaderboards.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  position: integer("position").notNull(),
  user_id: integer("user_id")
    .notNull()
    .references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
  video_row_id: integer("video_row_id")
    .references(() => user_tiktok_videos.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  video_id: text("video_id").notNull(),
  video_title: text("video_title").notNull(),
  video_cover_image_url: text("video_cover_image_url"),
  video_share_url: text("video_share_url"),
  view_count: integer("view_count").notNull().default(0),
  like_count: integer("like_count").notNull().default(0),
  comment_count: integer("comment_count").notNull().default(0),
  share_count: integer("share_count").notNull().default(0),
  reward: text("reward").notNull(),
  status: text("status").notNull().default("pending_review"),
  review_note: text("review_note"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});
