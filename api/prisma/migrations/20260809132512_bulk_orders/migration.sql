-- Migration: bulk_orders
-- Adds BulkOrder envelope, relaxes Cart to per-shop uniqueness,
-- links Order → BulkOrder, adds multiShopSurchargePaise to ServiceableCity.

-- 1. New enum for BulkOrder status
CREATE TYPE "BulkOrderStatus" AS ENUM (
  'PLACED','ACCEPTED_ALL','READY_ALL','RIDER_ASSIGNED',
  'PICKING_UP','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'
);

-- 2. BulkOrder table
CREATE TABLE "BulkOrder" (
  "id"                      TEXT NOT NULL,
  "shortId"                 TEXT,
  "customerId"              TEXT NOT NULL,
  "addressId"               TEXT NOT NULL,
  "status"                  "BulkOrderStatus" NOT NULL DEFAULT 'PLACED',
  "paymentMethod"           "PaymentMethod" NOT NULL,
  "baseDeliveryFeePaise"    INTEGER NOT NULL,
  "multiShopSurchargePaise" INTEGER NOT NULL,
  "platformFeePaise"        INTEGER NOT NULL,
  "totalPaise"              INTEGER NOT NULL,
  "riderId"                 TEXT,
  "pickupSequenceJson"      TEXT,
  "pickupOtp"               TEXT,
  "offeredRiderId"          TEXT,
  "offerExpiresAt"          TIMESTAMP(3),
  "dispatchTriedRiderIds"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "dispatchRadiusMeters"    INTEGER,
  "dispatchExhausted"       BOOLEAN NOT NULL DEFAULT false,
  "idempotencyKey"          TEXT NOT NULL,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL,
  "deletedAt"               TIMESTAMP(3),
  CONSTRAINT "BulkOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BulkOrder_shortId_key" ON "BulkOrder"("shortId");
CREATE UNIQUE INDEX "BulkOrder_idempotencyKey_key" ON "BulkOrder"("idempotencyKey");
CREATE INDEX "BulkOrder_customerId_idx" ON "BulkOrder"("customerId");
CREATE INDEX "BulkOrder_status_idx" ON "BulkOrder"("status");
CREATE INDEX "BulkOrder_riderId_idx" ON "BulkOrder"("riderId");

ALTER TABLE "BulkOrder"
  ADD CONSTRAINT "BulkOrder_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "BulkOrder_addressId_fkey"
    FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "BulkOrder_riderId_fkey"
    FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Link Order → BulkOrder (nullable — existing orders untouched)
ALTER TABLE "Order" ADD COLUMN "bulkOrderId" TEXT;
CREATE INDEX "Order_bulkOrderId_idx" ON "Order"("bulkOrderId");
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_bulkOrderId_fkey"
    FOREIGN KEY ("bulkOrderId") REFERENCES "BulkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Relax Cart unique constraint: from (customerId) to (customerId, shopId)
DROP INDEX IF EXISTS "Cart_customerId_key";
CREATE UNIQUE INDEX "Cart_customerId_shopId_key" ON "Cart"("customerId", "shopId");

-- 5. Add multiShopSurchargePaise to ServiceableCity (default ₹10 = 1000 paise)
ALTER TABLE "ServiceableCity"
  ADD COLUMN "multiShopSurchargePaise" INTEGER NOT NULL DEFAULT 1000;
