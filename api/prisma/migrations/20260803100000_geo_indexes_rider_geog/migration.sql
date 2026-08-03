-- Geo performance hardening.
--
-- Two problems this migration fixes, both invisible until the tables grow:
--
-- 1. The Shop/Address GIST indexes from 20260729103539 were lost on a DB reset
--    (raw-SQL migrations don't re-run, and Prisma can't manage the Unsupported
--    geog type, so `prisma db push`/reset drops them silently). Recreated here
--    idempotently so the nearby-shop ST_DWithin discovery query is index-backed
--    instead of a full Seq Scan on every customer home load.
--
-- 2. RiderProfile had NO geog column at all, so the three rider-proximity
--    checks (cart availability, rider go-online, order placement) computed
--    geography(ST_MakePoint(lng,lat)) per row and Seq Scanned RiderProfile every
--    time — on hot customer paths. Add a derived geog column + GIST index,
--    backfilled from latitude/longitude and maintained by the app on write.

CREATE EXTENSION IF NOT EXISTS postgis;

-- (1) Recreate the Shop/Address GIST indexes (idempotent).
CREATE INDEX IF NOT EXISTS shop_geog_gist    ON "Shop"    USING GIST (geog);
CREATE INDEX IF NOT EXISTS address_geog_gist ON "Address" USING GIST (geog);

-- (2) RiderProfile derived geography column + GIST index.
ALTER TABLE "RiderProfile" ADD COLUMN IF NOT EXISTS geog geography(Point, 4326);

UPDATE "RiderProfile"
   SET geog = ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)::geography
 WHERE geog IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS riderprofile_geog_gist ON "RiderProfile" USING GIST (geog);

-- (3) GIN indexes for Coupon array-membership queries. Coupon.shopIds and
-- cityIds are String[] filtered with {has:...} / = ANY(...) on the coupon
-- listing paths (customer checkout coupon list, per-city coupon scoping). Without
-- a GIN index these Seq Scan the Coupon table on every lookup.
CREATE INDEX IF NOT EXISTS coupon_shopids_gin ON "Coupon" USING GIN ("shopIds");
CREATE INDEX IF NOT EXISTS coupon_cityids_gin ON "Coupon" USING GIN ("cityIds");
