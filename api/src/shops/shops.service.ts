import {
  BadRequestException,
  ConflictException,
  Injectable,
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
import { requireShopScope } from '../common/shop-scope';
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
        `PassWaala is not available in ${city} yet. Please check back soon.`,
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
        name: dto.name,
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
    return this.toPublicView(shop);
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
    const orderBy =
      q.sort === 'rating'
        ? '"avgRating" DESC, distance_meters ASC'
        : 'distance_meters ASC';

    const openNow = q.openNow === 'true';
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
      }>
    >(
      `
      SELECT id, name, "shopCategory", "storefrontPhotoUrl", "logoUrl", "bannerUrl",
             "isOpen", "avgRating", "ratingCount", "minOrderValuePaise",
             "deliveryFeePaise", "freeDeliveryAbovePaise", "city", "addressLine", "contactPhone",
             "offerText", latitude, longitude, "platformDeliveryEnabled", "selfPickupEnabled",
             ST_Distance(geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters
        FROM "Shop"
       WHERE "deletedAt" IS NULL
         AND "verificationStatus" = 'APPROVED'
         AND "isOpen" = TRUE
         AND geog IS NOT NULL
         AND ST_DWithin(geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
         AND ($4::boolean IS NOT TRUE OR "isOpen" = TRUE)
         AND ($5::text IS NULL OR "shopCategory" = $5)
         AND ($6::double precision IS NULL OR "avgRating" >= $6)
       ORDER BY ${orderBy}
       LIMIT 100
      `,
      q.lng,
      q.lat,
      radius,
      openNow,
      q.category ?? null,
      q.minRating ?? null,
    );

    // For each unique city in the results, get the delivery radius config
    const cities = [...new Set(rows.map(r => r.city).filter(Boolean))];
    const cityConfigs = await this.prisma.serviceableCity.findMany({
      where: { name: { in: cities }, deletedAt: null },
      select: { name: true, deliveryRadiusMeters: true, riderCheckRadiusMeters: true },
    });
    const cityRadiusMap: Record<string, number> = {};
    const cityRiderRadiusMap: Record<string, number> = {};
    for (const c of cityConfigs) {
      cityRadiusMap[c.name] = c.deliveryRadiusMeters;
      cityRiderRadiusMap[c.name] = (c as { riderCheckRadiusMeters?: number }).riderCheckRadiusMeters ?? 5000;
    }

    // Fuzzy city lookup: "Jhansi, UP" or "Mewatipura, Jhansi" should match "Jhansi"
    function getCityConfig(shopCity: string): { delivery: number; rider: number } {
      const sc = shopCity.toLowerCase();
      for (const [name, delivery] of Object.entries(cityRadiusMap)) {
        const nc = name.toLowerCase();
        if (sc === nc || sc.includes(nc) || nc.includes(sc)) {
          return { delivery, rider: cityRiderRadiusMap[name] ?? 5000 };
        }
      }
      return { delivery: 15000, rider: 5000 }; // defaults when city not found
    }

    // Check which shops have a rider online within their city's radius
    // Do this in a single query: get all online riders, then check per shop
    const onlineRiders = await this.prisma.riderProfile.findMany({
      where: { online: true, latitude: { not: null }, longitude: { not: null } },
      select: { latitude: true, longitude: true },
    });

    function hasRiderNearby(shopLat: unknown, shopLng: unknown, radiusM: number): boolean {
      const sLat = shopLat ? Number(shopLat) : NaN;
      const sLng = shopLng ? Number(shopLng) : NaN;
      if (isNaN(sLat) || isNaN(sLng)) return false;
      for (const rider of onlineRiders) {
        const rLat = Number(rider.latitude);
        const rLng = Number(rider.longitude);
        if (isNaN(rLat) || isNaN(rLng)) continue;
        // Simple haversine
        const R = 6371000;
        const dLat = (rLat - sLat) * Math.PI / 180;
        const dLng = (rLng - sLng) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(sLat*Math.PI/180) * Math.cos(rLat*Math.PI/180) * Math.sin(dLng/2)**2;
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        if (dist <= radiusM) return true;
      }
      return false;
    }

    // Tag each shop: deliveryAvailable = a delivery option works right now;
    // deliveryUnavailable = no fulfilment option works at all (no delivery AND
    // no self-pickup). Self-delivery shops always have delivery.
    const tagged = rows.map(r => {
      if (!r.platformDeliveryEnabled) {
        return { ...r, deliveryAvailable: true, deliveryUnavailable: false };
      }
      const cfg = getCityConfig(r.city ?? '');
      const riderNearby = hasRiderNearby(r.latitude, r.longitude, cfg.rider);
      if (riderNearby) {
        return { ...r, deliveryAvailable: true, deliveryUnavailable: false };
      }
      // No rider — delivery is off. Shop is still usable if self-pickup is on.
      return { ...r, deliveryAvailable: false, deliveryUnavailable: !r.selfPickupEnabled };
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
    }));
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
}
