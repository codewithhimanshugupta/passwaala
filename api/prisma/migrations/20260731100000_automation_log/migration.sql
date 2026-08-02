CREATE TABLE "AutomationLog" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "action"      TEXT NOT NULL,
  "detail"      TEXT NOT NULL,
  "orderId"     TEXT,
  "shopId"      TEXT,
  "riderUserId" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutomationLog_action_idx"    ON "AutomationLog"("action");
CREATE INDEX "AutomationLog_createdAt_idx" ON "AutomationLog"("createdAt");
CREATE INDEX "AutomationLog_shopId_idx"    ON "AutomationLog"("shopId");
CREATE INDEX "AutomationLog_orderId_idx"   ON "AutomationLog"("orderId");
