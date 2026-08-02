CREATE TABLE "Coupon" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "code"            TEXT NOT NULL,
  "type"            TEXT NOT NULL,          -- PERCENT_OFF | FLAT_OFF | FREE_DELIVERY
  "value"           INTEGER NOT NULL DEFAULT 0,  -- percent or paise
  "description"     TEXT,
  "minOrderPaise"   INTEGER NOT NULL DEFAULT 0,
  "maxUses"         INTEGER,               -- null = unlimited
  "maxUsesPerUser"  INTEGER,               -- null = unlimited
  "usedCount"       INTEGER NOT NULL DEFAULT 0,
  "validFrom"       TIMESTAMP(3),
  "expiresAt"       TIMESTAMP(3),
  "active"          BOOLEAN NOT NULL DEFAULT true,
  "shopIds"         TEXT[] DEFAULT ARRAY[]::TEXT[],  -- empty = all shops
  "createdById"     TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"       TIMESTAMP(3)
);
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");
CREATE INDEX "Coupon_active_idx" ON "Coupon"("active");
CREATE INDEX "Coupon_code_idx" ON "Coupon"("code");

CREATE TABLE "CouponUsage" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "couponId"   TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "orderId"    TEXT NOT NULL,
  "usedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CouponUsage_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE
);
CREATE INDEX "CouponUsage_couponId_idx" ON "CouponUsage"("couponId");
CREATE INDEX "CouponUsage_userId_couponId_idx" ON "CouponUsage"("userId", "couponId");
