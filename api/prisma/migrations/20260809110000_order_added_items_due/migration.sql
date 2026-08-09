-- Items added post-placement on a prepaid order: the delta is collected at delivery.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "addedItemsDuePaise" INTEGER NOT NULL DEFAULT 0;
