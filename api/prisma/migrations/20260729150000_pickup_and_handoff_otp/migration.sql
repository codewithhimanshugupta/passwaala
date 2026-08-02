-- Self-pickup fulfillment mode + handoff OTP on every order.
ALTER TYPE "DeliveryMode" ADD VALUE IF NOT EXISTS 'SELF_PICKUP';
ALTER TABLE "Order" ADD COLUMN "pickupOtp" TEXT;
