-- Encrypted login PIN column (added when auth moved to a user-chosen PIN).
-- The prior rework updated schema.prisma + auth.service but missed this DDL.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "loginPinEnc" TEXT;
