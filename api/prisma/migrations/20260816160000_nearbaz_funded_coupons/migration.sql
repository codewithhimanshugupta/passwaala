-- NearBaz-funded ("platform-funded") city coupons. All additive (rule #7),
-- PgBouncer-safe (IF NOT EXISTS everywhere). No destructive statements.

-- ── Coupon: who bears the discount ──────────────────────────────────────────
-- "SHOP" (default) = shop absorbs it, like an offer. "NEARBAZ" = platform-funded:
-- NearBaz eats the discount as a marketing cost; the shop's ledger is untouched.
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "fundedBy" TEXT NOT NULL DEFAULT 'SHOP';

-- ── Order: NearBaz-funded discount + coupon linkage ─────────────────────────
-- nearbazDiscountPaise is the platform-funded portion (never charged to the shop);
-- couponId/couponCode record the single coupon applied (mutually exclusive w/ offer).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "nearbazDiscountPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "couponId"   TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "couponCode" TEXT;

-- ── PlatformLedgerEntry: NearBaz's own cost ledger (NOT shop-scoped) ─────────
-- Records COUPON_SUBSIDY entries — the discount NearBaz funded on platform-funded
-- coupons. Lightweight audit table (mirrors AutomationLog): plain columns, no FKs.
CREATE TABLE IF NOT EXISTS "PlatformLedgerEntry" (
  "id"          TEXT NOT NULL,
  "type"        TEXT NOT NULL,
  "orderId"     TEXT,
  "couponId"    TEXT,
  "cityId"      TEXT,
  "userId"      TEXT,
  "amountPaise" INTEGER NOT NULL,
  "couponCode"  TEXT,
  "note"        TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"   TIMESTAMP(3),
  CONSTRAINT "PlatformLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PlatformLedgerEntry_type_idx"      ON "PlatformLedgerEntry"("type");
CREATE INDEX IF NOT EXISTS "PlatformLedgerEntry_orderId_idx"   ON "PlatformLedgerEntry"("orderId");
CREATE INDEX IF NOT EXISTS "PlatformLedgerEntry_couponId_idx"  ON "PlatformLedgerEntry"("couponId");
CREATE INDEX IF NOT EXISTS "PlatformLedgerEntry_cityId_idx"    ON "PlatformLedgerEntry"("cityId");
CREATE INDEX IF NOT EXISTS "PlatformLedgerEntry_createdAt_idx" ON "PlatformLedgerEntry"("createdAt");
