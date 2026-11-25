import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

/** Postgres en memoria para probar migraciones. Nunca es la base de datos real. */
export function memoryDb() {
  return new PGlite();
}

export function migration(name: string): string {
  return fs.readFileSync(path.resolve(__dirname, "..", name), "utf8");
}

/** Las columnas de `products` que usan las migraciones de stock (0043 y 0044). */
export const PRODUCTS_TABLE = `
CREATE TABLE products (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name text NOT NULL, image text NOT NULL, price integer NOT NULL, created_at integer NOT NULL,
  description text NOT NULL, stock integer DEFAULT 0 NOT NULL,
  codes jsonb DEFAULT '[]' NOT NULL, used_codes jsonb DEFAULT '[]' NOT NULL,
  sendable boolean DEFAULT false NOT NULL, is_auction boolean DEFAULT false NOT NULL,
  min_bid_increment integer DEFAULT 1 NOT NULL, auction_ends_at integer,
  current_bid integer DEFAULT 0 NOT NULL, current_bidder_user_id integer,
  auction_reopens_at integer, auction_round integer DEFAULT 1 NOT NULL,
  auction_status text DEFAULT 'in_progress' NOT NULL, auction_prize_assigned boolean DEFAULT false NOT NULL,
  auction_starting_notified boolean DEFAULT false NOT NULL,
  value_eur numeric(10,2), requires_trade_link boolean NOT NULL DEFAULT false,
  delivery_type text NOT NULL DEFAULT 'code', category text, currency text NOT NULL DEFAULT 'points',
  available_from integer, counts_for_cap boolean NOT NULL DEFAULT true
);`;
