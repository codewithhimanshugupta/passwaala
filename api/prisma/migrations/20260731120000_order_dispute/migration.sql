-- OrderDispute: tracks help/dispute requests raised by customers, shopkeepers, or riders
-- on a specific order within the 48h window. One per order.
CREATE TABLE "OrderDispute" (
  "id"              TEXT NOT NULL,
  "orderId"         TEXT NOT NULL,
  "raisedById"      TEXT NOT NULL,
  "raisedByRole"    TEXT NOT NULL,
  "reason"          TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'OPEN',
  "assignedAdminId" TEXT,
  "assignedAt"      TIMESTAMP(3),
  "resolvedAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderDispute_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderDispute_orderId_key" ON "OrderDispute"("orderId");
CREATE INDEX "OrderDispute_status_idx" ON "OrderDispute"("status");
CREATE INDEX "OrderDispute_assignedAdminId_idx" ON "OrderDispute"("assignedAdminId");

-- DisputeMessage: chat messages within a dispute thread.
CREATE TABLE "DisputeMessage" (
  "id"         TEXT NOT NULL,
  "disputeId"  TEXT NOT NULL,
  "senderId"   TEXT NOT NULL,
  "senderRole" TEXT NOT NULL,
  "body"       TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisputeMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DisputeMessage_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "OrderDispute"("id") ON DELETE CASCADE
);
CREATE INDEX "DisputeMessage_disputeId_idx" ON "DisputeMessage"("disputeId");
