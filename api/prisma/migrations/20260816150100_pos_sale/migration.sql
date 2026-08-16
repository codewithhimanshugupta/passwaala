-- In-store POS (counter) sale flag on Order. A walk-in sale is created by the
-- shopkeeper directly at DELIVERED, paid CASH, commission-free. This flag lets
-- the feed/reports distinguish counter sales from delivery/pickup orders.
-- Additive only (rule #7).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "isPosSale" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Order_shopId_isPosSale_idx" ON "Order"("shopId", "isPosSale");
