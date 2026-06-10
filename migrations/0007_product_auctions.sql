-- Auction support for products and bid history

ALTER TABLE products
ADD COLUMN IF NOT EXISTS is_auction BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS min_bid_increment INTEGER NOT NULL DEFAULT 1;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS auction_ends_at INTEGER;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS current_bid INTEGER NOT NULL DEFAULT 0;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS current_bidder_user_id INTEGER;

CREATE TABLE IF NOT EXISTS product_bids (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON UPDATE CASCADE ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_product_bids_product_id ON product_bids(product_id);
CREATE INDEX IF NOT EXISTS idx_product_bids_created_at ON product_bids(created_at);
