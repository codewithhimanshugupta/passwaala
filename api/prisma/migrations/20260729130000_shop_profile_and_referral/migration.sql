-- Round 3: shop public-profile fields + user referral code.
-- All additive (nullable or defaulted) — safe on populated tables (rule #7).

-- Shop public profile (city owner-decided; pilot default Jhansi).
ALTER TABLE "Shop" ADD COLUMN "city" TEXT NOT NULL DEFAULT 'Jhansi';
ALTER TABLE "Shop" ADD COLUMN "addressLine" TEXT;
ALTER TABLE "Shop" ADD COLUMN "contactPhone" TEXT;

-- User referral code (unique, nullable for existing rows).
ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");
