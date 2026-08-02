-- PassWaala's own UPI collection details per serviceable city. Owner-configured
-- in the admin panel; shopkeepers in the city pay their dues to this VPA.
-- Nullable + additive (no backfill). Never exposed on the public city list.
ALTER TABLE "ServiceableCity" ADD COLUMN "collectionUpiVpa" TEXT;
ALTER TABLE "ServiceableCity" ADD COLUMN "collectionUpiName" TEXT;

-- A shopkeeper's dues payment to PassWaala (signed-negative amount on the ledger).
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'PAYMENT';

