-- Rider COD dues: uncleared cash the rider owes onward, with a ₹500 credit cap
-- that blocks accepting new orders / going online until an admin clears it.
ALTER TABLE "RiderProfile" ADD COLUMN "duesPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RiderProfile" ADD COLUMN "creditLimitPaise" INTEGER NOT NULL DEFAULT 50000;
