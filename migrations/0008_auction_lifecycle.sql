-- Auction lifecycle support: sequential rounds, cooldown and per-bid statuses

ALTER TABLE products
ADD COLUMN IF NOT EXISTS auction_duration_seconds INTEGER NOT NULL DEFAULT 3600;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS auction_cooldown_seconds INTEGER NOT NULL DEFAULT 300;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS auction_parent_product_id INTEGER;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS auction_starting_notified BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS auction_reopens_at INTEGER;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS auction_round INTEGER NOT NULL DEFAULT 1;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS auction_status TEXT NOT NULL DEFAULT 'in_progress';

ALTER TABLE products
ADD COLUMN IF NOT EXISTS auction_prize_assigned BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE product_bids
ADD COLUMN IF NOT EXISTS auction_round INTEGER NOT NULL DEFAULT 1;

ALTER TABLE product_bids
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'in_progress';

CREATE INDEX IF NOT EXISTS idx_products_auction_status ON products(auction_status);
CREATE INDEX IF NOT EXISTS idx_products_auction_reopens_at ON products(auction_reopens_at);
CREATE INDEX IF NOT EXISTS idx_products_auction_parent_product_id ON products(auction_parent_product_id);
CREATE INDEX IF NOT EXISTS idx_product_bids_product_round ON product_bids(product_id, auction_round);
CREATE INDEX IF NOT EXISTS idx_product_bids_status ON product_bids(status);
