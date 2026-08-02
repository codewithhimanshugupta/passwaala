-- Human-readable support IDs.
-- User:  C  + first 8 hex chars of UUID  → C035CD8E
-- Shop:  S  + first 8 hex chars of UUID  → S4F02BBE9
-- Order: OR + first 8 hex chars of UUID  → OR035CD8E
ALTER TABLE "User"  ADD COLUMN "shortId" TEXT UNIQUE;
ALTER TABLE "Shop"  ADD COLUMN "shortId" TEXT UNIQUE;
ALTER TABLE "Order" ADD COLUMN "shortId" TEXT UNIQUE;

-- Back-fill existing rows: take first 8 hex chars of the UUID (no dashes).
UPDATE "User"  SET "shortId" = 'C'  || UPPER(SUBSTRING(REPLACE(id::text, '-', ''), 1, 8)) WHERE "shortId" IS NULL;
UPDATE "Shop"  SET "shortId" = 'S'  || UPPER(SUBSTRING(REPLACE(id::text, '-', ''), 1, 8)) WHERE "shortId" IS NULL;
UPDATE "Order" SET "shortId" = 'OR' || UPPER(SUBSTRING(REPLACE(id::text, '-', ''), 1, 8)) WHERE "shortId" IS NULL;
