-- Proximity rider dispatch: per-order offer state so a READY platform order can
-- be offered to the nearest online rider, re-offered on timeout to the next
-- nearest (widening the search ring), and opened to all riders once exhausted.
ALTER TABLE "Order" ADD COLUMN "offeredRiderId" TEXT;
ALTER TABLE "Order" ADD COLUMN "offerExpiresAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "dispatchTriedRiderIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Order" ADD COLUMN "dispatchRadiusMeters" INTEGER;
ALTER TABLE "Order" ADD COLUMN "dispatchExhausted" BOOLEAN NOT NULL DEFAULT false;
