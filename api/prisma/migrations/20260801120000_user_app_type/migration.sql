-- Step 1: add appType column with default CUSTOMER
ALTER TABLE "User" ADD COLUMN "appType" TEXT NOT NULL DEFAULT 'CUSTOMER';

-- Step 2: backfill appType from role
UPDATE "User" SET "appType" = 
  CASE 
    WHEN role = 'SHOPKEEPER' THEN 'SHOPKEEPER'
    WHEN role = 'RIDER' THEN 'RIDER'
    WHEN role = 'ADMIN' THEN 'ADMIN'
    WHEN role = 'OWNER' THEN 'OWNER'
    ELSE 'CUSTOMER'
  END;

-- Step 3: drop old global unique on phone (it's an INDEX, not a named
-- constraint — DROP CONSTRAINT is a no-op here, so drop the index too).
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_phone_key";
DROP INDEX IF EXISTS "User_phone_key";

-- Step 4: add composite unique index
CREATE UNIQUE INDEX "User_phone_appType_key" ON "User"("phone", "appType");
