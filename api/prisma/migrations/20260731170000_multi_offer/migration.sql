-- Create explicit join table for shop ↔ offer (many-to-many)
CREATE TABLE "_ShopOffers" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL
);
CREATE UNIQUE INDEX "_ShopOffers_AB_unique" ON "_ShopOffers"("A", "B");
CREATE INDEX "_ShopOffers_B_index" ON "_ShopOffers"("B");

-- Migrate existing single activeOfferId → join table
INSERT INTO "_ShopOffers" ("A", "B")
SELECT "id", "activeOfferId" FROM "Shop"
WHERE "activeOfferId" IS NOT NULL;

-- Drop the old FK column
ALTER TABLE "Shop" DROP COLUMN IF EXISTS "activeOfferId";
