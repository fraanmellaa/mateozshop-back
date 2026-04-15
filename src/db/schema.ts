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
  codes: jsonb("codes").notNull().default("[]").$type<string[]>(),
  used_codes: jsonb("used_codes").notNull().default("[]").$type<string[]>(),
  sendable: boolean("sendable").notNull().default(false),
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
