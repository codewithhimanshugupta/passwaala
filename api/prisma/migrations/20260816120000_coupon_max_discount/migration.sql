-- Cap for percentage coupons: max discount in paise (null = no cap)
ALTER TABLE "Coupon" ADD COLUMN "maxDiscountPaise" INTEGER;
