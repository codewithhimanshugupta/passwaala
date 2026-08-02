-- Owner-controlled serviceable cities (PassWaala operates only in enabled cities).
CREATE TABLE "ServiceableCity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "ServiceableCity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServiceableCity_name_key" ON "ServiceableCity"("name");
CREATE INDEX "ServiceableCity_enabled_idx" ON "ServiceableCity"("enabled");

-- Seed the pilot city so existing shops (Jhansi) remain serviceable.
INSERT INTO "ServiceableCity" ("id", "name", "enabled", "updatedAt")
VALUES (gen_random_uuid(), 'Jhansi', true, CURRENT_TIMESTAMP);
