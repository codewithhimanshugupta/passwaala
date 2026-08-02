-- PassWaala Coins redeemed on an order (1 coin = ₹1 = 100 paise), item-subtotal discount.
ALTER TABLE "Order" ADD COLUMN "coinsRedeemedPaise" INTEGER NOT NULL DEFAULT 0;
