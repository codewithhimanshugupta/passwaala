-- Phone + password login (+ encrypted backup OTP). Additive, nullable columns.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "loginOtpEnc" TEXT;
