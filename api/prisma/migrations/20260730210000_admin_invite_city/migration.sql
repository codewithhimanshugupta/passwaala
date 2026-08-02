ALTER TABLE "AdminInvite" ADD COLUMN "cityId" TEXT REFERENCES "ServiceableCity"("id") ON DELETE SET NULL;
