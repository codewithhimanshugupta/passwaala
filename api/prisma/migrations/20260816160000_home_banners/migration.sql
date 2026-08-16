-- Home banner carousel: admin-uploaded promo images shown to customers on the
-- discovery/home screen, optionally targeted to specific cities (empty cities =
-- all cities). Additive only (rule #7). PgBouncer-safe (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "Banner" (
  "id"        TEXT NOT NULL,
  "imageUrl"  TEXT NOT NULL,
  "cities"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Banner_active_idx" ON "Banner"("active");
