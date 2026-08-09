-- Admin can edit delivery fee on live orders.
-- For prepaid (UPI_DIRECT + paymentConfirmed) orders, the delta is stored here
-- so the rider knows to collect it on delivery.
ALTER TABLE "Order" ADD COLUMN "extraDeliveryDuePaise" INTEGER NOT NULL DEFAULT 0;
