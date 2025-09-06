import { integer, text, pgTable } from "drizzle-orm/pg-core";

/*
  npx drizzle-kit generate   
  npx drizzle-kit push
*/

export const users = pgTable("users", {
  id: integer("id").primaryKey().unique().generatedAlwaysAsIdentity(),
  username: text("username").notNull().unique(),
  kick_id: text("kick_id").notNull().unique(),
  image: text("image").notNull(),
  email: text("email").notNull().unique(),
  total_points: integer("total_points").notNull().default(0),
  used_points: integer("used_points").notNull().default(0),
  created_at: integer("created_at").notNull(),
});

export const products = pgTable("products", {
  id: integer("id").primaryKey().unique().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  image: text("image").notNull(),
  price: integer("price").notNull(),
  stock: integer("stock").notNull().default(0),
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
  winner: integer("winner")
    .notNull()
    .references(() => users.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
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
