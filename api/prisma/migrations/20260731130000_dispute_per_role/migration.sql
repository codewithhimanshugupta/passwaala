-- Drop the single-order unique constraint, replace with (orderId, raisedByRole)
DROP INDEX IF EXISTS "OrderDispute_orderId_key";
CREATE UNIQUE INDEX "OrderDispute_orderId_role_key" ON "OrderDispute"("orderId", "raisedByRole");
