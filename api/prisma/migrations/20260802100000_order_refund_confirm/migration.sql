-- Add REFUNDED to the OrderStatus enum (append-only)
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';

-- Customer refund-received confirmation timestamp
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "refundConfirmedAt" TIMESTAMP(3);
