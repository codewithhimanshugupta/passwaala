-- Query-performance indexes from the full DB audit.
--
-- Every index here backs a filter+sort (or filter alone) that currently forces a
-- Seq Scan or an in-memory sort on a growing table. Grouped by the path they
-- serve. All additive; `IF NOT EXISTS` so re-running is safe. (The RiderProfile
-- geog + Coupon GIN indexes were added in 20260803100000.)

-- ── Order: keyset-paginated admin lists + shopkeeper stats window ──
-- statsForShop() filters shopId + createdAt window (only shopId / shopId+status exist).
CREATE INDEX IF NOT EXISTS "Order_shopId_createdAt_idx"
  ON "Order" ("shopId", "createdAt");
-- listAllOrders() keyset paginates by createdAt desc, id desc with no status filter.
CREATE INDEX IF NOT EXISTS "Order_createdAt_id_idx"
  ON "Order" ("createdAt" DESC, "id" DESC);
-- disputedOrders() filters status IN (...) then sorts updatedAt desc, id desc; also
-- serves automation staleness sweeps (status + updatedAt<cutoff).
CREATE INDEX IF NOT EXISTS "Order_status_updatedAt_id_idx"
  ON "Order" ("status", "updatedAt" DESC, "id" DESC);

-- ── LedgerEntry: shopkeeper ledger + GST monthly invoice generation ──
-- listForShop() + plnSummaryForShop() filter shopId then sort createdAt desc.
CREATE INDEX IF NOT EXISTS "LedgerEntry_shopId_createdAt_id_idx"
  ON "LedgerEntry" ("shopId", "createdAt" DESC, "id" DESC);
-- generateMonthlyInvoices() filters type IN (COMMISSION,PLATFORM_FEE) + createdAt window.
CREATE INDEX IF NOT EXISTS "LedgerEntry_type_createdAt_idx"
  ON "LedgerEntry" ("type", "createdAt");

-- ── Products / Reviews: shop catalog + public reviews sorts ──
CREATE INDEX IF NOT EXISTS "Product_shopId_createdAt_idx"
  ON "Product" ("shopId", "createdAt" DESC) WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Review_shopId_createdAt_idx"
  ON "Review" ("shopId", "createdAt" DESC) WHERE "deletedAt" IS NULL;

-- ── Queues sorted by time: payment claims, referrals, tax invoices, automation ──
CREATE INDEX IF NOT EXISTS "PaymentClaim_status_claimedAt_idx"
  ON "PaymentClaim" ("status", "claimedAt");
CREATE INDEX IF NOT EXISTS "Referral_referrerId_createdAt_idx"
  ON "Referral" ("referrerId", "createdAt");
CREATE INDEX IF NOT EXISTS "TaxInvoice_createdAt_idx"
  ON "TaxInvoice" ("createdAt");
-- recentNotifications() filters riderUserId then sorts createdAt desc (no riderUserId index today).
CREATE INDEX IF NOT EXISTS "AutomationLog_riderUserId_createdAt_idx"
  ON "AutomationLog" ("riderUserId", "createdAt");

-- ── User / AdminInvite / Shop: admin console lookups ──
-- listCustomers() filters appType then sorts createdAt desc (composite has appType non-leading).
CREATE INDEX IF NOT EXISTS "User_appType_createdAt_idx"
  ON "User" ("appType", "createdAt" DESC);
-- Admin login + invite lookups do findFirst on AdminInvite.phone (no index today).
CREATE INDEX IF NOT EXISTS "AdminInvite_phone_idx"
  ON "AdminInvite" ("phone");
-- listAllShops() optional case-insensitive city filter (lower(city) = lower($1)).
CREATE INDEX IF NOT EXISTS "Shop_lower_city_idx"
  ON "Shop" (lower("city"));
-- ServiceableCity is looked up by lower(name) on hot cart/order/rider paths
-- (name: { equals, mode: insensitive }); the unique btree on name can't serve it.
CREATE INDEX IF NOT EXISTS "ServiceableCity_lower_name_idx"
  ON "ServiceableCity" (lower("name"));
