-- Platform-rider pickup handshake: a new RIDER_ASSIGNED order state (rider
-- claimed a READY order, en route to the shop) plus a rider pickup OTP shown in
-- the shopkeeper app and entered by the rider to confirm collection.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'RIDER_ASSIGNED';
ALTER TABLE "Order" ADD COLUMN "riderPickupOtp" TEXT;
