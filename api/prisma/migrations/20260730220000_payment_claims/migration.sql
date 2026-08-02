-- PaymentClaim: tracks payment claims from shopkeepers (dues) and riders (COD deposits)
-- so admins can verify before clearing balances.
CREATE TABLE "PaymentClaim" (
  "id"          TEXT NOT NULL,
  "entityType"  TEXT NOT NULL,
  "shopId"      TEXT,
  "riderUserId" TEXT,
  "amountPaise" INTEGER NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'PENDING',
  "claimedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clearedAt"   TIMESTAMP(3),
  "clearedById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentClaim_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PaymentClaim_status_idx" ON "PaymentClaim"("status");
CREATE INDEX "PaymentClaim_shopId_idx" ON "PaymentClaim"("shopId");
CREATE INDEX "PaymentClaim_riderUserId_idx" ON "PaymentClaim"("riderUserId");
