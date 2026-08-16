-- Zomato-style shop ranking + opt-in CPC sponsored ads + per-customer taste
-- profile + medical-store prescription flow. All additive (rule #7).

-- ── New enum types ─────────────────────────────────────────────────────────
CREATE TYPE "AdCampaignStatus"   AS ENUM ('ACTIVE', 'PAUSED', 'EXHAUSTED', 'EXPIRED');
CREATE TYPE "AdEventType"        AS ENUM ('IMPRESSION', 'CLICK');
CREATE TYPE "PrescriptionStatus" AS ENUM ('SUBMITTED', 'QUOTED', 'CONVERTED', 'REJECTED');

-- ── ServiceableCity: ads + ranking config knobs ───────────────────────────
ALTER TABLE "ServiceableCity" ADD COLUMN "sponsoredCpcPaise"           INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "ServiceableCity" ADD COLUMN "sponsoredDefaultBudgetPaise" INTEGER NOT NULL DEFAULT 50000;
ALTER TABLE "ServiceableCity" ADD COLUMN "newShopBoostDays"            INTEGER NOT NULL DEFAULT 21;

-- ── Shop: ranking signals ──────────────────────────────────────────────────
ALTER TABLE "Shop" ADD COLUMN "rankScore"   DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Shop" ADD COLUMN "orderCount"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Shop" ADD COLUMN "lastOrderAt" TIMESTAMP(3);
ALTER TABLE "Shop" ADD COLUMN "isPremium"   BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Shop_rankScore_idx" ON "Shop"("rankScore");
CREATE INDEX "Shop_isPremium_idx" ON "Shop"("isPremium");

-- ── OrderItem: productId becomes nullable (free-text prescription lines) ────
ALTER TABLE "OrderItem" ALTER COLUMN "productId" DROP NOT NULL;

-- ── AdCampaign ─────────────────────────────────────────────────────────────
CREATE TABLE "AdCampaign" (
  "id"               TEXT NOT NULL,
  "shopId"           TEXT NOT NULL,
  "status"           "AdCampaignStatus" NOT NULL DEFAULT 'ACTIVE',
  "cpcPaise"         INTEGER NOT NULL,
  "totalBudgetPaise" INTEGER NOT NULL,
  "dailyBudgetPaise" INTEGER NOT NULL DEFAULT 0,
  "spentPaise"       INTEGER NOT NULL DEFAULT 0,
  "spentTodayPaise"  INTEGER NOT NULL DEFAULT 0,
  "dayResetAt"       TIMESTAMP(3),
  "cityIds"          TEXT[] DEFAULT ARRAY[]::TEXT[],
  "startAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endAt"            TIMESTAMP(3),
  "createdById"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"        TIMESTAMP(3),
  CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdCampaign_shopId_idx" ON "AdCampaign"("shopId");
CREATE INDEX "AdCampaign_status_idx" ON "AdCampaign"("status");
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── AdEvent ────────────────────────────────────────────────────────────────
CREATE TABLE "AdEvent" (
  "id"          TEXT NOT NULL,
  "campaignId"  TEXT NOT NULL,
  "shopId"      TEXT NOT NULL,
  "type"        "AdEventType" NOT NULL,
  "customerId"  TEXT,
  "billedPaise" INTEGER NOT NULL DEFAULT 0,
  "settledAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdEvent_campaignId_idx" ON "AdEvent"("campaignId");
CREATE INDEX "AdEvent_shopId_idx" ON "AdEvent"("shopId");
CREATE INDEX "AdEvent_type_idx" ON "AdEvent"("type");
CREATE INDEX "AdEvent_createdAt_idx" ON "AdEvent"("createdAt");
CREATE INDEX "AdEvent_campaignId_customerId_type_idx" ON "AdEvent"("campaignId", "customerId", "type");
ALTER TABLE "AdEvent" ADD CONSTRAINT "AdEvent_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "AdCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdEvent" ADD CONSTRAINT "AdEvent_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdEvent" ADD CONSTRAINT "AdEvent_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── CustomerProfile ────────────────────────────────────────────────────────
CREATE TABLE "CustomerProfile" (
  "id"                  TEXT NOT NULL,
  "userId"              TEXT NOT NULL,
  "categoryWeightsJson" JSONB,
  "avgOrderValuePaise"  INTEGER NOT NULL DEFAULT 0,
  "orderCount"          INTEGER NOT NULL DEFAULT 0,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerProfile_userId_key" ON "CustomerProfile"("userId");
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Prescription ───────────────────────────────────────────────────────────
CREATE TABLE "Prescription" (
  "id"              TEXT NOT NULL,
  "shortId"         TEXT,
  "customerId"      TEXT NOT NULL,
  "shopId"          TEXT NOT NULL,
  "imageUrls"       TEXT[] DEFAULT ARRAY[]::TEXT[],
  "note"            TEXT,
  "status"          "PrescriptionStatus" NOT NULL DEFAULT 'SUBMITTED',
  "rejectionReason" TEXT,
  -- Customer's delivery choice, captured at upload (the shop, not the customer,
  -- triggers the quote that creates the Order, so it must be persisted here).
  "deliveryMode"    "DeliveryMode" NOT NULL DEFAULT 'SELF_PICKUP',
  "addressId"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"       TIMESTAMP(3),
  CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Prescription_shortId_key" ON "Prescription"("shortId");
CREATE INDEX "Prescription_customerId_idx" ON "Prescription"("customerId");
CREATE INDEX "Prescription_shopId_idx" ON "Prescription"("shopId");
CREATE INDEX "Prescription_status_idx" ON "Prescription"("status");
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_addressId_fkey"
  FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Order: prescription link (1:1) ─────────────────────────────────────────
ALTER TABLE "Order" ADD COLUMN "prescriptionId" TEXT;
CREATE UNIQUE INDEX "Order_prescriptionId_key" ON "Order"("prescriptionId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_prescriptionId_fkey"
  FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
