-- OfferType enum
CREATE TYPE "OfferType" AS ENUM ('PERCENT_OFF', 'FLAT_OFF', 'FREE_DELIVERY');

-- OfferTemplate table
CREATE TABLE "OfferTemplate" (
  "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "cityId"        TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "type"          "OfferType" NOT NULL,
  "value"         INTEGER NOT NULL DEFAULT 0,
  "minOrderPaise" INTEGER NOT NULL DEFAULT 0,
  "active"        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"     TIMESTAMP(3),
  CONSTRAINT "OfferTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OfferTemplate_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "ServiceableCity"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "OfferTemplate_cityId_idx" ON "OfferTemplate"("cityId");
CREATE INDEX "OfferTemplate_active_idx"  ON "OfferTemplate"("active");

-- Shop: add activeOfferId
ALTER TABLE "Shop" ADD COLUMN "activeOfferId" TEXT;
ALTER TABLE "Shop" ADD CONSTRAINT "Shop_activeOfferId_fkey"
  FOREIGN KEY ("activeOfferId") REFERENCES "OfferTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Order: add discount snapshot columns
ALTER TABLE "Order" ADD COLUMN "discountPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "offerId"       TEXT;
ALTER TABLE "Order" ADD COLUMN "offerTitle"    TEXT;
