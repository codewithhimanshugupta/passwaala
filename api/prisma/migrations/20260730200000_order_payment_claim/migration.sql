-- Order UPI payment-claim handshake: customer claims payment, shop verifies.
ALTER TABLE "Order" ADD COLUMN     "paymentClaimedAt" TIMESTAMP(3),
ADD COLUMN     "paymentClaimCount" INTEGER NOT NULL DEFAULT 0;
