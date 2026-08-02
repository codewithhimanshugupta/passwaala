-- PostGIS geo columns + GIST indexes (see api/prisma/schema.prisma NOTE block).
--
-- Prisma cannot manage PostGIS geography types directly, so latitude/longitude
-- Decimal columns stay the human-readable SOURCE OF TRUTH, and this migration
-- adds a DERIVED, indexed `geog geography(Point, 4326)` column on the two
-- geo-bearing tables (Shop, Address). This powers the nearby-shop ST_DWithin
-- radius query (plan → Scalability: Geo-indexing) without a table scan.
--
-- The geog column is maintained from longitude/latitude by the app/trigger on
-- write (Phase 1+). This migration also backfills any existing rows.

-- 1. PostGIS extension (idempotent; the postgis image usually pre-enables it).
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Add the derived geography(Point, 4326) columns (nullable — populated from
--    longitude/latitude, additive-only per schema rule #7).
ALTER TABLE "Shop"    ADD COLUMN IF NOT EXISTS geog geography(Point, 4326);
ALTER TABLE "Address" ADD COLUMN IF NOT EXISTS geog geography(Point, 4326);

-- 3. Backfill geog from the existing longitude/latitude source of truth.
UPDATE "Shop"
   SET geog = ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)::geography
 WHERE geog IS NULL;

UPDATE "Address"
   SET geog = ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)::geography
 WHERE geog IS NULL;

-- 4. GIST indexes so radius queries (ST_DWithin) never table-scan.
CREATE INDEX IF NOT EXISTS shop_geog_gist    ON "Shop"    USING GIST (geog);
CREATE INDEX IF NOT EXISTS address_geog_gist ON "Address" USING GIST (geog);
