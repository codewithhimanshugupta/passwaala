import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  DEFAULT_CREDIT_LIMIT_PAISE,
  UserRole,
  VerificationStatus,
} from '@passwaala/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CitiesService } from '../cities/cities.service';
import { MemoryCache } from '../common/memory-cache';
import { requireShopScope } from '../common/shop-scope';
import { titleCaseName } from '../common/text.util';
import { RegisterShopDto } from './dto/register-shop.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { NearbyShopsQuery } from './dto/nearby-shops.query';

/**
 * ShopsService — shop registration, profile, KYC/verification, and the public
 * storefront read (plan → Shop Onboarding, Shop Data Isolation, Discovery).
 *
 * HARD RULES enforced here:
 *  - A shop is DRAFT on creation and NOT discoverable until APPROVED. The public
 *    read returns only APPROVED shops (never DRAFT/PENDING/REJECTED/SUSPENDED).
 *  - verificationStatus / commissionRate / creditLimit are server-controlled,
 *    never from client input.
 *  - Registering a shop promotes the caller to SHOPKEEPER server-side (role is
 *    never client-supplied) and re-issues a token carrying their new shopId.
 *  - KYC docs are never exposed here (admin-only elsewhere).
 */
@Injectable()
export class ShopsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly cities: CitiesService,
    private readonly cache: MemoryCache,
  ) {}

  /**
   * Register the caller's shop. Creates the Shop (DRAFT), promotes the user to
   * SHOPKEEPER, and returns the shop plus a fresh access token scoped to it.
   * One shop per owner for the MVP.
   */
  async register(userId: string, dto: RegisterShopDto) {
    const city = dto.city ?? '';
    if (!city) throw new BadRequestException('City is required');
    if (!(await this.cities.isServiceable(city))) {
      throw new BadRequestException(
        `NearBaz is not available in ${city} yet. Please check back soon.`,
      );
    }

    // Multi-shop: an owner MAY register more than one shop. Each new shop starts
    // DRAFT and is approved independently. (The app lets them switch between shops.)
    const shopId = randomUUID();
    const shopShortId = `S${shopId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const shop = await this.prisma.shop.create({
      data: {
        id: shopId,
        shortId: shopShortId,
        ownerId: userId,
        name: titleCaseName(dto.name),
        shopCategory: dto.shopCategory,
        storefrontPhotoUrl: dto.storefrontPhotoUrl,
        logoUrl: dto.logoUrl,
        bannerUrl: dto.bannerUrl,
        upiVpa: dto.upiVpa,
        latitude: dto.latitude,
        longitude: dto.longitude,
        city: dto.city,
        addressLine: dto.addressLine,
        contactPhone: dto.contactPhone,
        deliveryFeePaise: dto.deliveryFeePaise ?? 0,
        freeDeliveryAbovePaise: dto.freeDeliveryAbovePaise,
        minOrderValuePaise: dto.minOrderValuePaise ?? 0,
        platformDeliveryEnabled: dto.platformDeliveryEnabled ?? false,
        selfPickupEnabled: (dto as { selfPickupEnabled?: boolean }).selfPickupEnabled ?? true,
        offerText: dto.offerText,
        // Server-controlled: starts DRAFT, hidden until admin approval.
        verificationStatus: VerificationStatus.DRAFT,
        creditLimitPaise: DEFAULT_CREDIT_LIMIT_PAISE,
      },
    });

    // Promote to SHOPKEEPER (role is server-assigned, never from client input).
    await this.prisma.user.update({
      where: { id: userId },
      data: { role: UserRole.SHOPKEEPER },
    });

    // Populate geog from the provided coordinates (out-of-band PostGIS column).
    await this.syncGeog(shop.id, dto.longitude, dto.latitude);

    // Re-issue a token that now carries the shopId scope.
    const accessToken = await this.auth.signFor(userId, UserRole.SHOPKEEPER, shop.id);
    return { shop: this.toOwnerView(shop), accessToken };
  }

  /**
   * Submit KYC for the caller's shop, moving DRAFT → PENDING_REVIEW. Upserts the
   * 1:1 ShopKyc row. The shop stays hidden until an admin approves.
   */
  async submitKyc(shopId: string | undefined, dto: SubmitKycDto) {
    const id = requireShopScope(shopId);
    const shop = await this.prisma.shop.findFirst({
      where: { id, deletedAt: null },
      select: { verificationStatus: true },
    });
    if (!shop) {
      throw new BadRequestException('Shop not found');
    }
    if (
      shop.verificationStatus !== VerificationStatus.DRAFT &&
      shop.verificationStatus !== VerificationStatus.REJECTED
    ) {
      throw new ConflictException(
        `KYC cannot be submitted from status ${shop.verificationStatus}`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.shopKyc.upsert({
        where: { shopId: id },
        create: {
          shopId: id,
          aadhaarPan: dto.aadhaarPan,
          gstOrLicence: dto.gstOrLicence,
          fssai: dto.fssai,
          bankProofUrl: dto.bankProofUrl,
          docUrls: dto.docUrls,
        },
        update: {
          aadhaarPan: dto.aadhaarPan,
          gstOrLicence: dto.gstOrLicence,
          fssai: dto.fssai,
          bankProofUrl: dto.bankProofUrl,
          docUrls: dto.docUrls,
        },
      }),
      this.prisma.shop.update({
        where: { id },
        data: { verificationStatus: VerificationStatus.PENDING_REVIEW },
      }),
    ]);

    return { verificationStatus: VerificationStatus.PENDING_REVIEW };
  }

  /** The caller's own shop (full owner view). */
  async findMyShop(shopId: string | undefined) {
    const id = requireShopScope(shopId);
    const shop = await this.prisma.shop.findFirst({
      where: { id, deletedAt: null },
      include: { activeOffer: { select: { id: true, title: true, type: true, value: true, minOrderPaise: true } } },
    });
    if (!shop) throw new BadRequestException('Shop not found');
    // Fetch which coupons this shop has activated (shopId in Coupon.shopIds)
    const activeCoupons = await this.prisma.coupon.findMany({
      where: { shopIds: { has: id }, deletedAt: null, active: true },
      select: { id: true },
    });
    const result = this.toOwnerView(shop) as ReturnType<typeof this.toOwnerView> & { activeCouponIds: string[] };
    result.activeCouponIds = activeCoupons.map(c => c.id);
    return result;
  }

  /** All shops owned by the user (multi-shop home picker). */
  async findMyShops(userId: string) {
    const shops = await this.prisma.shop.findMany({
      where: { ownerId: userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return shops.map((s) => this.toOwnerView(s));
  }

  /**
   * Switch the active shop: verify the user owns the target shop, then return a
   * fresh SHOPKEEPER token scoped to it. All @ShopId() routes then operate on
   * this shop with no per-route changes.
   */
  async switchShop(userId: string, shopId: string) {
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, ownerId: userId, deletedAt: null },
      select: { id: true },
    });
    if (!shop) {
      throw new BadRequestException('Shop not found or not yours');
    }
    const accessToken = await this.auth.signFor(userId, UserRole.SHOPKEEPER, shop.id);
    return { accessToken, shopId: shop.id };
  }

  /**
   * Toggle the shop's open/closed state (plan → Shopkeeper App: Store Online/
   * Offline toggle). A closed shop blocks checkout + hides from "open now".
   * Scoped to the caller's own shop.
   */
  async setOpen(shopId: string | undefined, isOpen: boolean) {
    const id = requireShopScope(shopId);
    const shop = await this.prisma.shop.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, outstandingDuesPaise: true, creditLimitPaise: true },
    });
    if (!shop) {
      throw new BadRequestException('Shop not found');
    }
    // Credit-limit enforcement (plan → Credit Limit): a shop over its limit
    // CANNOT go online until it pays down dues. Going offline is always allowed.
    if (isOpen && shop.outstandingDuesPaise >= shop.creditLimitPaise) {
      throw new BadRequestException(
        'Your dues have reached the credit limit. Pay down dues to go online.',
      );
    }
    const updated = await this.prisma.shop.update({
      where: { id },
      data: { isOpen },
      select: { isOpen: true },
    });
    return { isOpen: updated.isOpen };
  }

  /**
   * Update the caller's shop settings (economics + public profile + working
   * hours). Scoped to their own shop; all fields optional (partial update).
   */
  async updateSettings(shopId: string | undefined, dto: import('./dto/update-shop-settings.dto').UpdateShopSettingsDto) {
    const id = requireShopScope(shopId);
    const shop = await this.prisma.shop.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!shop) {
      throw new BadRequestException('Shop not found');
    }
    // Pre-resolve which IDs are OfferTemplates vs Coupons before the update
    const activeOfferIds = (dto as { activeOfferIds?: string[] | null }).activeOfferIds;
    let offerTemplateIdSet = new Set<string>();
    let couponIds: string[] = [];
    if (activeOfferIds !== undefined) {
      const templateRows = await this.prisma.offerTemplate.findMany({
        where: { id: { in: activeOfferIds ?? [] }, deletedAt: null },
        select: { id: true },
      });
      offerTemplateIdSet = new Set(templateRows.map(o => o.id));
      couponIds = (activeOfferIds ?? []).filter(i => !offerTemplateIdSet.has(i));
    }
    const firstTemplateId = activeOfferIds !== undefined
      ? ([...(activeOfferIds ?? [])].find(i => offerTemplateIdSet.has(i)) ?? null)
      : undefined;

    const updated = await this.prisma.shop.update({
      where: { id },
      data: {
        addressLine: dto.addressLine,
        contactPhone: dto.contactPhone,
        city: dto.city,
        upiVpa: dto.upiVpa,
        gstin: (dto as { gstin?: string }).gstin,
        stateCode: (dto as { stateCode?: string }).stateCode,
        legalName: (dto as { legalName?: string }).legalName,
        deliveryFeePaise: dto.deliveryFeePaise,
        freeDeliveryAbovePaise: dto.freeDeliveryAbovePaise,
        minOrderValuePaise: dto.minOrderValuePaise,
        platformDeliveryEnabled: dto.platformDeliveryEnabled,
        selfPickupEnabled: (dto as { selfPickupEnabled?: boolean }).selfPickupEnabled,
        offerText: dto.offerText,
        workingHours: dto.workingHours ?? undefined,
        ...(firstTemplateId !== undefined ? { activeOfferId: firstTemplateId } : {}),
      },
      include: { activeOffer: { select: { id: true, title: true, type: true, value: true, minOrderPaise: true } } },
    });

    // Handle coupon assignment for selected coupon IDs
    if (activeOfferIds !== undefined) {
      if (couponIds.length > 0) {
        // Deduplicated add — fetch current shopIds and set-merge
        const existing = await this.prisma.coupon.findMany({
          where: { id: { in: couponIds }, deletedAt: null },
          select: { id: true, shopIds: true },
        });
        await Promise.all(existing.map(c =>
          this.prisma.coupon.update({
            where: { id: c.id },
            data: { shopIds: Array.from(new Set([...c.shopIds, id])) },
          }).catch(() => {})
        ));
      }
      // Remove shop from coupons that were deselected
      const allCoupons = await this.prisma.coupon.findMany({
        where: { shopIds: { has: id }, deletedAt: null },
        select: { id: true, shopIds: true },
      });
      await Promise.all(
        allCoupons
          .filter(c => !couponIds.includes(c.id))
          .map(c => this.prisma.coupon.update({
            where: { id: c.id },
            data: { shopIds: c.shopIds.filter((s: string) => s !== id) },
          }).catch(() => {}))
      );
    }

    return this.toOwnerView(updated);
  }

  /**
   * Public storefront view of one shop — ONLY if APPROVED. Any other status
   * (DRAFT/PENDING/REJECTED/SUSPENDED) is treated as not-found so an unapproved
   * shop is never discoverable (plan → KYC gate).
   */
  async findPublic(id: string) {
    const shop = await this.prisma.shop.findFirst({
      where: {
        id,
        deletedAt: null,
        verificationStatus: VerificationStatus.APPROVED,
      },
      include: {
        activeOffer: { select: { id: true, title: true, type: true, value: true, minOrderPaise: true } },
      },
    });
    if (!shop) {
      throw new BadRequestException('Shop not found');
    }
    // Preload everything the cart needs to compute the bill LOCALLY (no server
    // round-trip at checkout): the city's delivery fee-tiers + rider radius, the
    // city offer templates, and this shop's active coupons. Fetched in parallel.
    const [cityCfg, cityOffers, shopCoupons] = await Promise.all([
      shop.city
        ? this.prisma.serviceableCity.findFirst({
            where: {
              deletedAt: null,
              OR: [
                { name: { equals: shop.city, mode: 'insensitive' } },
                { name: { in: shop.city.split(',').map((p) => p.trim()) } },
              ],
            },
            select: { deliveryTiersJson: true, riderCheckRadiusMeters: true, deliveryRadiusMeters: true },
          })
        : Promise.resolve(null),
      shop.city
        ? this.prisma.offerTemplate.findMany({
            where: { city: { name: { equals: shop.city, mode: 'insensitive' } }, active: true, deletedAt: null },
            select: { id: true, title: true, type: true, value: true, minOrderPaise: true },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve([]),
      this.prisma.coupon.findMany({
        where: { shopIds: { has: shop.id }, active: true, deletedAt: null },
        select: { id: true, code: true, description: true, type: true, value: true, minOrderPaise: true },
      }),
    ]);
    const couponOffers = shopCoupons.map((c) => ({
      id: c.id,
      title: c.code + (c.description ? ` — ${c.description}` : ''),
      type: c.type,
      value: c.value,
      minOrderPaise: c.minOrderPaise,
    }));
    return {
      ...this.toPublicView(shop),
      // Delivery fee-tier config so the client computes the exact distance fee.
      deliveryTiers: cityCfg?.deliveryTiersJson ? JSON.parse(cityCfg.deliveryTiersJson) : null,
      riderCheckRadiusMeters: cityCfg?.riderCheckRadiusMeters ?? null,
      // Admin-set serviceable delivery radius (metres) — the client blocks a drop
      // outside this circle with an "out of delivery range" message.
      deliveryRadiusMeters: cityCfg?.deliveryRadiusMeters ?? null,
      // The full offer/coupon list so the cart shows + applies offers instantly.
      availableOffers: [...cityOffers, ...couponOffers],
    };
  }

  /**
   * Customer discovery: nearby APPROVED shops within a radius, via the PostGIS
   * GIST-indexed geog column (ST_DWithin — never a table scan; plan →
   * Scalability: Geo-indexing). Supports sort (distance/rating) + filters
   * (open now, category, min rating). Distance is returned in metres.
   *
   * Uses a parameterized raw query because Prisma can't express PostGIS ops;
   * all inputs are bound parameters (no SQL string-building — injection-safe).
   */
  async findNearby(q: NearbyShopsQuery) {
    const radius = q.radiusMeters ?? 3000;
    const limit = q.limit ?? 15;
    const offset = q.offset ?? 0;

    // Personalization (cheap, off the hot path): the requester's favourite shop
    // categories from their precomputed CustomerProfile (recomputeCustomerProfiles
    // cron). We only need the top few category slugs — membership drives a small
    // additive rank boost in SQL. Cached 60s per customer so repeated home-screen
    // calls never re-hit the DB for the profile.
    let topCategories: string[] = [];
    if (q.customerId) {
      topCategories = await this.cache.wrap(
        `cust:topcats:${q.customerId}`,
        process.env.NODE_ENV === 'test' ? 0 : 60_000,
        async () => {
          const profile = await this.prisma.customerProfile.findUnique({
            where: { userId: q.customerId },
            select: { categoryWeightsJson: true },
          });
          const weights = (profile?.categoryWeightsJson as Record<string, number> | null) ?? {};
          return Object.entries(weights)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([cat]) => cat);
        },
      );
    }

    // Sponsored (ads) and open/closed are pinned first in BOTH sort modes. The
    // core relevance is the PRECOMPUTED rankScore (indexed) multiplied by a
    // distance-decay so nearer shops rank higher without distance alone winning,
    // plus a personalization boost for favourite categories. sort=rating falls
    // back to a Bayesian rating order (still sponsored/open-first).
    // NOTE: a SELECT output alias (distance_meters) may only be referenced in
    // ORDER BY as a *standalone* term — Postgres resolves names *inside* an
    // expression against real input columns only, so the personalization decay
    // must inline the ST_Distance() expression, not the alias, or the query
    // fails with `column "distance_meters" does not exist` (42703).
    const distExpr = `ST_Distance(s.geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)`;
    const personalizedScore =
      `((s."rankScore" + CASE WHEN s."shopCategory" = ANY($9::text[]) THEN 25 ELSE 0 END)` +
      ` * (1.0 / (1.0 + ${distExpr} / 1000.0)))`;
    const orderBy =
      q.sort === 'rating'
        ? 'is_sponsored DESC, s."isOpen" DESC, ("ratingCount" * "avgRating" + 5 * 3.0) / ("ratingCount" + 5) DESC, distance_meters ASC'
        : `is_sponsored DESC, s."isOpen" DESC, ${personalizedScore} DESC, s."rankScore" DESC, distance_meters ASC`;

    const openNow = q.openNow === 'true';
    const hasOffers = q.hasOffers === 'true';
    // Cache the discovery list briefly (15s), keyed on the query. Coords are
    // rounded to ~3 decimals (~110m) so customers in the same area share a cache
    // entry — the home screen's repeated identical calls then skip the DB. Short
    // TTL keeps open/closed + new-shop changes fresh enough for a pilot. Disabled
    // under tests so each case reads fresh state (the in-memory cache would
    // otherwise survive resetDb between cases and cause cross-test bleed).
    const ttl = process.env.NODE_ENV === 'test' ? 0 : 15_000;
    const cacheKey = [
      'shops:nearby',
      Number(q.lat).toFixed(3),
      Number(q.lng).toFixed(3),
      radius, limit, offset, orderBy, openNow,
      q.category ?? '', q.minRating ?? '',
      q.city ?? '', hasOffers,
      topCategories.join(',') || '-',
    ].join(':');
    return this.cache.wrap(cacheKey, ttl, async () => {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        name: string;
        shopCategory: string;
        storefrontPhotoUrl: string;
        logoUrl: string | null;
        bannerUrl: string | null;
        isOpen: boolean;
        avgRating: number;
        ratingCount: number;
        minOrderValuePaise: number;
        deliveryFeePaise: number;
        freeDeliveryAbovePaise: number | null;
        city: string;
        addressLine: string | null;
        contactPhone: string | null;
        offerText: string | null;
        latitude: unknown;
        longitude: unknown;
        distance_meters: number;
        platformDeliveryEnabled: boolean;
        selfPickupEnabled: boolean;
        isPremium: boolean;
        is_sponsored: boolean;
        ad_campaign_id: string | null;
      }>
    >(
      `
      SELECT s.id, s.name, s."shopCategory", s."storefrontPhotoUrl", s."logoUrl", s."bannerUrl",
             s."isOpen", s."avgRating", s."ratingCount", s."minOrderValuePaise",
             s."deliveryFeePaise", s."freeDeliveryAbovePaise", s."city", s."addressLine", s."contactPhone",
             s."offerText", s.latitude, s.longitude, s."platformDeliveryEnabled", s."selfPickupEnabled",
             s."isPremium",
             (spon.campaign_id IS NOT NULL) AS is_sponsored,
             spon.campaign_id AS ad_campaign_id,
             ST_Distance(s.geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters
        FROM "Shop" s
        LEFT JOIN LATERAL (
          -- The shop's currently-serveable sponsored campaign (if any): ACTIVE,
          -- within lifetime budget, AND within today's daily cap. When the daily
          -- cap is hit the ad auto-stops (drops out here) until the next day or a
          -- budget raise (spentTodayPaise < dailyBudgetPaise) auto-resumes it.
          SELECT ac.id AS campaign_id
            FROM "AdCampaign" ac
           WHERE ac."shopId" = s.id
             AND ac.status = 'ACTIVE'
             AND ac."deletedAt" IS NULL
             AND ac."startAt" <= NOW()
             AND (ac."endAt" IS NULL OR ac."endAt" > NOW())
             AND ac."spentPaise" < ac."totalBudgetPaise"
             AND (
               ac."dailyBudgetPaise" = 0
               OR ac."dayResetAt" IS NULL
               OR ac."dayResetAt" < date_trunc('day', NOW())
               OR ac."spentTodayPaise" < ac."dailyBudgetPaise"
             )
           ORDER BY ac."cpcPaise" DESC
           LIMIT 1
        ) spon ON TRUE
       WHERE s."deletedAt" IS NULL
         -- Always reference $9 (topCategories) so Postgres can infer its type.
         -- The sort=rating ORDER BY branch omits the personalization term (the
         -- only other place $9 appears), and an unreferenced parameter fails at
         -- prepare time with 42P18 "could not determine data type of parameter".
         AND ($9::text[] IS NOT NULL OR TRUE)
         AND ($10::text IS NULL OR s.city ILIKE $10)
         AND s."verificationStatus" = 'APPROVED'
         AND s."isOpen" = TRUE
         AND s.geog IS NOT NULL
         AND ST_DWithin(s.geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
         AND ($4::boolean IS NOT TRUE OR s."isOpen" = TRUE)
         AND ($5::text IS NULL OR s."shopCategory" = $5)
         AND ($6::double precision IS NULL OR s."avgRating" >= $6)
         AND ($11::boolean IS NOT TRUE OR (s."offerText" IS NOT NULL AND s."offerText" <> ''))
       ORDER BY ${orderBy}
       LIMIT $7 OFFSET $8
      `,
      q.lng,
      q.lat,
      radius,
      openNow,
      q.category ?? null,
      q.minRating ?? null,
      limit,
      offset,
      topCategories,
      q.city ?? null,
      hasOffers,
    );

    // NOTE (perf): we no longer scan ALL online riders + haversine per shop on
    // every nearby call — that was the biggest hot-path cost. The list now
    // optimistically reports delivery as available; whether a rider is actually
    // online near a shop is resolved LAZILY per-shop via GET /shops/:id/
    // delivery-available (a cheap short-circuit query) when the customer opens a
    // shop, and definitively at dispatch time (dispatch.offerNext). This keeps
    // the discovery list fast and paginated.
    const tagged = rows.map(r => {
      // Delivery is "available" from the list's perspective when the shop
      // self-delivers, OR it's a platform-delivery shop (rider presence checked
      // lazily), OR self-pickup is on. Unusable only if no fulfilment path exists.
      const anyFulfilment = !r.platformDeliveryEnabled || r.platformDeliveryEnabled || r.selfPickupEnabled;
      return {
        ...r,
        deliveryAvailable: true,
        deliveryUnavailable: !anyFulfilment,
      };
    });

    return tagged.map((r) => ({
      id: r.id,
      name: r.name,
      shopCategory: r.shopCategory,
      storefrontPhotoUrl: r.storefrontPhotoUrl,
      logoUrl: r.logoUrl ?? undefined,
      bannerUrl: r.bannerUrl ?? undefined,
      isOpen: r.isOpen,
      avgRating: r.avgRating,
      ratingCount: r.ratingCount,
      minOrderValuePaise: r.minOrderValuePaise,
      deliveryFeePaise: r.deliveryFeePaise,
      freeDeliveryAbovePaise: r.freeDeliveryAbovePaise,
      city: r.city,
      addressLine: r.addressLine ?? undefined,
      contactPhone: r.contactPhone ?? undefined,
      offerText: r.offerText ?? undefined,
      latitude: r.latitude != null ? Number(r.latitude) : undefined,
      longitude: r.longitude != null ? Number(r.longitude) : undefined,
      distanceMeters: Math.round(r.distance_meters),
      platformDeliveryEnabled: r.platformDeliveryEnabled,
      selfPickupEnabled: r.selfPickupEnabled,
      deliveryAvailable: r.deliveryAvailable,
      deliveryUnavailable: r.deliveryUnavailable ?? false,
      isPremium: r.isPremium,
      isSponsored: r.is_sponsored,
      adCampaignId: r.ad_campaign_id ?? undefined,
    }));
    });
  }

  /**
   * Admin-curated "Premium" shops near the customer, for the dedicated Premium
   * section on the home screen. Same PostGIS radius + rankScore ordering as
   * discovery but filtered to isPremium shops. Cached 30s (the set changes only
   * when admin toggles premium). Kept lean + paginated so the section is instant.
   */
  async findPremium(q: NearbyShopsQuery) {
    const radius = q.radiusMeters ?? 5000;
    const limit = q.limit ?? 10;
    const offset = q.offset ?? 0;
    const ttl = process.env.NODE_ENV === 'test' ? 0 : 30_000;
    const cacheKey = [
      'shops:premium',
      Number(q.lat).toFixed(3),
      Number(q.lng).toFixed(3),
      radius, limit, offset,
      q.city ?? '',
    ].join(':');
    return this.cache.wrap(cacheKey, ttl, async () => {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{
          id: string; name: string; shopCategory: string; storefrontPhotoUrl: string;
          logoUrl: string | null; bannerUrl: string | null; isOpen: boolean;
          avgRating: number; ratingCount: number; minOrderValuePaise: number;
          deliveryFeePaise: number; freeDeliveryAbovePaise: number | null; city: string;
          offerText: string | null; latitude: unknown; longitude: unknown;
          distance_meters: number; platformDeliveryEnabled: boolean; selfPickupEnabled: boolean;
        }>
      >(
        `
        SELECT id, name, "shopCategory", "storefrontPhotoUrl", "logoUrl", "bannerUrl",
               "isOpen", "avgRating", "ratingCount", "minOrderValuePaise",
               "deliveryFeePaise", "freeDeliveryAbovePaise", "city", "offerText",
               latitude, longitude, "platformDeliveryEnabled", "selfPickupEnabled",
               ST_Distance(geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters
          FROM "Shop"
         WHERE "deletedAt" IS NULL
           AND ($6::text IS NULL OR "city" ILIKE $6)
           AND "verificationStatus" = 'APPROVED'
           AND "isOpen" = TRUE
           AND "isPremium" = TRUE
           AND geog IS NOT NULL
           AND ST_DWithin(geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
         ORDER BY "rankScore" DESC, distance_meters ASC
         LIMIT $4 OFFSET $5
        `,
        q.lng, q.lat, radius, limit, offset, q.city ?? null,
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        shopCategory: r.shopCategory,
        storefrontPhotoUrl: r.storefrontPhotoUrl,
        logoUrl: r.logoUrl ?? undefined,
        bannerUrl: r.bannerUrl ?? undefined,
        isOpen: r.isOpen,
        avgRating: r.avgRating,
        ratingCount: r.ratingCount,
        minOrderValuePaise: r.minOrderValuePaise,
        deliveryFeePaise: r.deliveryFeePaise,
        freeDeliveryAbovePaise: r.freeDeliveryAbovePaise,
        city: r.city,
        offerText: r.offerText ?? undefined,
        latitude: r.latitude != null ? Number(r.latitude) : undefined,
        longitude: r.longitude != null ? Number(r.longitude) : undefined,
        distanceMeters: Math.round(r.distance_meters),
        platformDeliveryEnabled: r.platformDeliveryEnabled,
        selfPickupEnabled: r.selfPickupEnabled,
        deliveryAvailable: true,
        isPremium: true,
      }));
    });
  }

  /**
   * Cheap, lazy "can this shop deliver right now?" check — called per-shop when
   * the customer opens a storefront, NOT for every shop in the discovery list.
   * Short-circuits: if the shop self-delivers, delivery is always available; for
   * a platform-delivery shop it asks Postgres for just ONE online rider within
   * the city's rider radius (ST_DWithin + LIMIT 1 — stops at the first match, no
   * full scan/rank). Returns pickup availability too so the app can show options.
   */
  async deliveryAvailableForShop(shopId: string): Promise<{
    deliveryAvailable: boolean;
    selfPickupEnabled: boolean;
  }> {
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, deletedAt: null },
      select: { platformDeliveryEnabled: true, selfPickupEnabled: true, city: true },
    });
    if (!shop) return { deliveryAvailable: false, selfPickupEnabled: false };

    // Self-delivering shops always have delivery — no rider needed.
    if (!shop.platformDeliveryEnabled) {
      return { deliveryAvailable: true, selfPickupEnabled: shop.selfPickupEnabled };
    }

    // City rider radius (default 5km).
    let riderRadius = 5000;
    if (shop.city) {
      const city = await this.prisma.serviceableCity.findFirst({
        where: { name: { equals: shop.city, mode: 'insensitive' }, deletedAt: null },
        select: { riderCheckRadiusMeters: true },
      });
      if (city?.riderCheckRadiusMeters) riderRadius = city.riderCheckRadiusMeters;
    }

    // Short-circuit: is there AT LEAST ONE online rider within range of the shop?
    // LIMIT 1 → Postgres stops at the first hit; never scans/ranks all riders.
    // Uses the GIST-indexed rp.geog column (maintained on write) so this is an
    // index probe, not a per-row ST_MakePoint computation over every rider.
    const hit = await this.prisma.$queryRawUnsafe<Array<{ ok: number }>>(
      `
      SELECT 1 AS ok
        FROM "RiderProfile" rp
        JOIN "Shop" s ON s.id = $1
       WHERE rp.online = TRUE
         AND rp.geog IS NOT NULL
         AND s.geog IS NOT NULL
         AND ST_DWithin(rp.geog, s.geog, $2)
       LIMIT 1
      `,
      shopId,
      riderRadius,
    );
    return { deliveryAvailable: hit.length > 0, selfPickupEnabled: shop.selfPickupEnabled };
  }

  /** Maintain the PostGIS geog point from lon/lat (raw SQL — Unsupported type). */
  private async syncGeog(shopId: string, longitude: number, latitude: number): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE "Shop" SET geog = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE id = $3`,
      longitude,
      latitude,
      shopId,
    );
  }

  /** Owner-facing view (safe subset — no KYC). */
  private toOwnerView(shop: {
    id: string;
    name: string;
    shopCategory: string;
    verificationStatus: string;
    storefrontPhotoUrl: string;
    isOpen: boolean;
    city?: string;
    addressLine?: string | null;
    contactPhone?: string | null;
    upiVpa?: string | null;
    deliveryFeePaise?: number;
    freeDeliveryAbovePaise?: number | null;
    minOrderValuePaise?: number;
    workingHours?: unknown;
    platformDeliveryEnabled?: boolean;
    offerText?: string | null;
    activeOfferId?: string | null;
    gstin?: string | null;
    stateCode?: string | null;
    legalName?: string | null;
  }) {
    return {
      id: shop.id,
      name: shop.name,
      shopCategory: shop.shopCategory,
      verificationStatus: shop.verificationStatus,
      storefrontPhotoUrl: shop.storefrontPhotoUrl,
      isOpen: shop.isOpen,
      city: shop.city,
      addressLine: shop.addressLine ?? undefined,
      contactPhone: shop.contactPhone ?? undefined,
      upiVpa: shop.upiVpa ?? undefined,
      gstin: shop.gstin ?? undefined,
      stateCode: shop.stateCode ?? undefined,
      legalName: shop.legalName ?? undefined,
      deliveryFeePaise: shop.deliveryFeePaise,
      freeDeliveryAbovePaise: shop.freeDeliveryAbovePaise ?? undefined,
      minOrderValuePaise: shop.minOrderValuePaise,
      workingHours: shop.workingHours ?? undefined,
      platformDeliveryEnabled: shop.platformDeliveryEnabled ?? false,
      selfPickupEnabled: (shop as Record<string, unknown>).selfPickupEnabled !== false,
      offerText: shop.offerText ?? undefined,
      activeOfferId: shop.activeOfferId ?? null,
      codEnabled: (shop as Record<string, unknown>).codEnabled !== false,
    };
  }

  /** Customer-facing public view (no private/operational data). */
  private toPublicView(shop: {
    id: string;
    name: string;
    shopCategory: string;
    storefrontPhotoUrl: string;
    logoUrl: string | null;
    bannerUrl: string | null;
    isOpen: boolean;
    avgRating: number;
    ratingCount: number;
    minOrderValuePaise: number;
    deliveryFeePaise: number;
    freeDeliveryAbovePaise: number | null;
    city?: string;
    addressLine?: string | null;
    contactPhone?: string | null;
    latitude?: unknown;
    longitude?: unknown;
    platformDeliveryEnabled?: boolean;
    offerText?: string | null;
    activeOffer?: { id: string; title: string; type: string; value: number; minOrderPaise: number } | null;
    activeOffers?: { id: string; title: string; type: string; value: number; minOrderPaise: number }[] | null;
  }) {
    return {
      id: shop.id,
      name: shop.name,
      shopCategory: shop.shopCategory,
      storefrontPhotoUrl: shop.storefrontPhotoUrl,
      logoUrl: shop.logoUrl ?? undefined,
      bannerUrl: shop.bannerUrl ?? undefined,
      isOpen: shop.isOpen,
      avgRating: shop.avgRating,
      ratingCount: shop.ratingCount,
      minOrderValuePaise: shop.minOrderValuePaise,
      deliveryFeePaise: shop.deliveryFeePaise,
      freeDeliveryAbovePaise: shop.freeDeliveryAbovePaise,
      city: shop.city,
      addressLine: shop.addressLine ?? undefined,
      contactPhone: shop.contactPhone ?? undefined,
      latitude: shop.latitude != null ? Number(shop.latitude) : undefined,
      longitude: shop.longitude != null ? Number(shop.longitude) : undefined,
      platformDeliveryEnabled: shop.platformDeliveryEnabled ?? false,
      selfPickupEnabled: (shop as Record<string, unknown>).selfPickupEnabled !== false,
      offerText: shop.offerText ?? undefined,
      activeOffers: (shop as { activeOffers?: unknown[] }).activeOffers ?? [],
    };
  }

  /** How many orders used each offer template on this shop (shopkeeper stats). */
  async offerStats(shopId: string | undefined) {
    const id = requireShopScope(shopId);
    const rows = await this.prisma.order.groupBy({
      by: ['offerId'],
      where: { shopId: id, offerId: { not: null }, deletedAt: null },
      _count: { _all: true },
    });
    return rows
      .filter(r => r.offerId)
      .map(r => ({ offerId: r.offerId!, usedCount: r._count._all }));
  }

  async submitAppeal(shopId: string | undefined, message: string) {
    const id = requireShopScope(shopId);
    if (!message?.trim()) throw new BadRequestException('Appeal message is required');
    const shop = await this.prisma.shop.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, verificationStatus: true },
    });
    if (!shop) throw new NotFoundException('Shop not found');
    const APPEALABLE = ['REJECTED', 'SUSPENDED'];
    if (!APPEALABLE.includes(shop.verificationStatus)) {
      throw new BadRequestException('Appeals can only be submitted for rejected or suspended shops');
    }
    await this.prisma.shop.update({
      where: { id },
      data: { appealMessage: message.trim(), appealSubmittedAt: new Date() },
    });
    return { submitted: true };
  }

  /**
   * Nearby shops for multi-shop bulk orders: APPROVED + open + platformDelivery,
   * within 1 km of the anchor shop, excluding the anchor itself.
   */
  async nearbyForBulk(anchorShopId: string, offset = 0) {
    const anchor = await this.prisma.shop.findUnique({
      where: { id: anchorShopId, deletedAt: null },
      select: { latitude: true, longitude: true, city: true },
    });
    if (!anchor?.latitude || !anchor?.longitude) return { items: [], hasMore: false };

    const cityCfg = await this.prisma.serviceableCity.findFirst({
      where: { name: { equals: anchor.city, mode: 'insensitive' } },
      select: { bulkShopRadiusMeters: true },
    });
    const radius = cityCfg?.bulkShopRadiusMeters ?? 1000;

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; name: string; city: string; latitude: unknown; longitude: unknown; distance_meters: number }>
    >(
      `SELECT id, name, city, latitude, longitude,
              ST_Distance(geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters
         FROM "Shop"
        WHERE "deletedAt" IS NULL
          AND "verificationStatus" = 'APPROVED'
          AND "isOpen" = TRUE
          AND geog IS NOT NULL
          AND id != $3
          AND city ILIKE $4
          AND ST_DWithin(geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $5)
        ORDER BY distance_meters ASC
        LIMIT $6 OFFSET $7`,
      Number(anchor.longitude),
      Number(anchor.latitude),
      anchorShopId,
      anchor.city,
      radius,
      10,
      offset,
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        city: r.city,
        latitude: r.latitude != null ? Number(r.latitude) : 0,
        longitude: r.longitude != null ? Number(r.longitude) : 0,
        distanceMeters: Math.round(r.distance_meters),
      })),
      hasMore: rows.length === 10,
    };
  }
}
