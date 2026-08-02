-- Optional shopkeeper-set promo string shown on the customer home card
-- (display-only; PassWaala does not apply it to the bill).
ALTER TABLE "Shop" ADD COLUMN "offerText" TEXT;
