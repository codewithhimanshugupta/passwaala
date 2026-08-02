-- Extend LedgerEntryType with new financial flow values (append-only, rule #5).
-- Postgres requires ADD VALUE to be committed before the value is used, so this
-- lives in its own migration, isolated from the tables that reference them.
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'COD_REMITTANCE';
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'RIDER_DELIVERY_FEE';
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'DISCOUNT_GIVEN';
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'SHOP_PAYOUT';
