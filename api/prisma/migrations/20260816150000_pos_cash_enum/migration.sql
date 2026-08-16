-- Append CASH to PaymentMethod for in-store POS (counter) sales (append-only,
-- rule #5). Postgres requires ADD VALUE to be committed before it is used, so
-- this lives in its own migration, isolated from the table/code that uses it.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CASH';
