-- COD-by-QR handshake: for a COD platform-rider order, the rider records that
-- the customer paid the shop's UPI at the door; the shop then confirms receipt
-- (sets paymentConfirmed) before the rider may mark the order DELIVERED.
ALTER TABLE "Order" ADD COLUMN "codUpiClaimedAt" TIMESTAMP(3);
