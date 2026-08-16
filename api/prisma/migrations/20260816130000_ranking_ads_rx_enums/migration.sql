-- Append new enum values (append-only, rule #5). Postgres requires ADD VALUE to
-- be committed before it is used, so these live in their own migration isolated
-- from the tables/code that reference them.
ALTER TYPE "OrderStatus"     ADD VALUE IF NOT EXISTS 'QUOTE_PENDING';
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'AD_SPEND';
