ALTER TABLE "AutomationLog"
  ADD COLUMN "revertedAt"   TIMESTAMP(3),
  ADD COLUMN "revertedById" TEXT,
  ADD COLUMN "revertNote"   TEXT;

CREATE INDEX "AutomationLog_revertedAt_idx" ON "AutomationLog"("revertedAt");
