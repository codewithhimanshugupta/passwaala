import { Injectable, Logger, NotImplementedException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { BulkOrderStatus, DeliveryMode, OrderStatus } from '@nearbaz/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WebPushService } from '../notifications/web-push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

/** A geo-coded point (lat/lng). Used for both single-point and two-point tasks. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/**
 * The capability a dispatch request needs — a rider, or a service category.
 * Kept as a string seam so future provider categories (PLUMBER, ELECTRICIAN…)
 * add values without reshaping the model (append-only spirit).
 */
export type DispatchCapability = 'RIDER' | string;

/**
 * A dispatch request: fan out to nearby available providers and let the first
 * to accept win (plan → Dispatch Engine). Covers all three future use cases —
 * rider delivery, rider errand, service visit — via an optional two-point shape.
 */
export interface DispatchRequest {
  /** Required capability (rider, or a service category). */
  capability: DispatchCapability;
  /** Optional pickup (shop / errand origin). Absent for a single-point service visit. */
  pickup?: GeoPoint;
  /** The destination (drop location, or the customer's address for a service visit). */
  destination: GeoPoint;
  /** Max search radius in metres for the candidate query. */
  maxRadiusMeters: number;
}

/** A ranked candidate provider from the candidate query. */
export interface DispatchCandidate {
  providerId: string;
  distanceMeters: number;
}

/** A lat/lng point (short form used by the rider offer loop). */
interface LatLng {
  lat: number;
  lng: number;
}

/**
 * DispatchService — proximity rider dispatch for PLATFORM_RIDER orders (plan →
 * Dispatch Engine). When an order is READY it's offered to the NEAREST eligible
 * online rider for a short window (OFFER_TTL). If they don't accept in time it's
 * re-offered to the next-nearest; when the current ring has no untried candidate
 * the search radius widens (RINGS). Once every ring is exhausted the order opens
 * to any online rider (dispatchExhausted). A self-healing interval sweep re-offers
 * expired offers, so nothing gets stuck even without realtime sockets.
 *
 * The generic findCandidates/dispatch seam (for future service categories) stays
 * as a documented boundary; the rider offer loop below is the built implementation.
 */
@Injectable()
export class DispatchService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DispatchService.name);

  /** Search rings (metres), widened in order when a ring has no candidate. */
  private static readonly RINGS = [2000, 5000, 10000];
  /** Fallback offer TTL when city has no config (ms). */
  private static readonly OFFER_TTL_MS = 15000;
  /** Fallback max active orders per rider when city has no config. */
  private static readonly MAX_ACTIVE_ORDERS = 2;
  /** How often the backstop sweep runs (ms). */
  private static readonly SWEEP_MS = 15000;

  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webPush: WebPushService,
    private readonly realtime: RealtimeGateway,
  ) {}

  onApplicationBootstrap(): void {
    // Skip the background sweep under tests — they drive tick()/offerNext directly
    // so behaviour is deterministic.
    if (process.env.NODE_ENV === 'test') return;
    this.sweepTimer = setInterval(() => {
      this.tick().catch((e) => this.logger.warn(`dispatch sweep failed: ${(e as Error).message}`));
    }, DispatchService.SWEEP_MS);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  /** Great-circle distance between two points, in metres. */
  private haversineMeters(a: LatLng, b: LatLng): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * Eligible riders for an order within `radius` of the shop, nearest-first:
   * online, serving the SAME city as the shop, with a known position, not already
   * tried, and under the active-order cap. Returns each with its distance from the
   * shop. City scoping keeps a Jhansi order from ever being offered to a rider who
   * serves a different city, independent of raw distance.
   */
  private async candidatesFor(
    shopGeo: LatLng,
    shopCity: string,
    triedRiderIds: string[],
    radiusMeters: number,
    maxActiveOrders = DispatchService.MAX_ACTIVE_ORDERS,
  ): Promise<Array<{ userId: string; distanceMeters: number }>> {
    const profiles = await this.prisma.riderProfile.findMany({
      where: {
        online: true,
        serviceCity: shopCity,
        latitude: { not: null },
        longitude: { not: null },
        userId: { notIn: triedRiderIds },
        deletedAt: null,
      },
      select: { userId: true, latitude: true, longitude: true },
    });
    if (profiles.length === 0) return [];
    // Active-order counts so we can drop riders already at the cap.
    const active = await this.prisma.order.groupBy({
      by: ['riderId'],
      where: {
        riderId: { in: profiles.map((p) => p.userId) },
        status: { in: [OrderStatus.RIDER_ASSIGNED, OrderStatus.OUT_FOR_DELIVERY] },
        deletedAt: null,
      },
      _count: { _all: true },
    });
    const activeByRider = new Map(active.map((a) => [a.riderId as string, a._count._all]));

    return profiles
      .filter((p) => (activeByRider.get(p.userId) ?? 0) < maxActiveOrders)
      .map((p) => ({
        userId: p.userId,
        distanceMeters: this.haversineMeters(shopGeo, {
          lat: Number(p.latitude),
          lng: Number(p.longitude),
        }),
      }))
      .filter((c) => c.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  /**
   * Offer the order to the next-nearest untried rider, widening the ring if the
   * current one has no candidate. Marks the order exhausted (open board) when all
   * rings are tried with no taker. No-op if the order isn't a claimable READY
   * platform order. Returns the offered rider id (or null when none/exhausted).
   */
  async offerNext(orderId: string): Promise<string | null> {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        deliveryMode: DeliveryMode.PLATFORM_RIDER,
        status: OrderStatus.READY,
        riderId: null,
        deletedAt: null,
      },
      select: {
        id: true,
        dispatchTriedRiderIds: true,
        dispatchRadiusMeters: true,
        dispatchExhausted: true,
        shop: { select: { latitude: true, longitude: true, city: true } },
      },
    });
    if (!order || order.dispatchExhausted) return null;
    if (order.shop?.latitude == null || order.shop?.longitude == null) return null;

    const shopGeo: LatLng = { lat: Number(order.shop.latitude), lng: Number(order.shop.longitude) };
    const shopCity = order.shop.city;
    const tried = order.dispatchTriedRiderIds;

    // Read city config for offer TTL + max active orders per rider
    const cityCfg = shopCity ? await this.prisma.serviceableCity.findFirst({
      where: { name: { equals: shopCity, mode: 'insensitive' }, deletedAt: null },
      select: { riderOfferWindowSec: true, maxActiveOrdersPerRider: true },
    }) : null;
    const offerTtlMs = (cityCfg?.riderOfferWindowSec ?? 15) * 1000;
    const maxActive = cityCfg?.maxActiveOrdersPerRider ?? DispatchService.MAX_ACTIVE_ORDERS;
    const startRing = order.dispatchRadiusMeters ?? DispatchService.RINGS[0];
    const startIdx = Math.max(0, DispatchService.RINGS.indexOf(startRing));

    for (let i = startIdx; i < DispatchService.RINGS.length; i += 1) {
      const radius = DispatchService.RINGS[i];
      const candidates = await this.candidatesFor(shopGeo, shopCity, tried, radius, maxActive);
      if (candidates.length > 0) {
        const chosen = candidates[0];
        await this.prisma.order.update({
          where: { id: orderId },
          data: {
            offeredRiderId: chosen.userId,
            offerExpiresAt: new Date(Date.now() + offerTtlMs),
            dispatchTriedRiderIds: { push: chosen.userId },
            dispatchRadiusMeters: radius,
          },
        });
        // Background push so the rider is alerted with the app closed / locked.
        void this.webPush.sendToUser(chosen.userId, {
          title: '🛵 New delivery job!',
          body: 'A delivery near you is ready. Tap to accept.',
          tag: `job-${orderId}`,
          url: '/',
        });
        // Live socket push so an open rider app shows the offer instantly (no poll).
        this.realtime.emitJobOffered(chosen.userId, { orderId });
        return chosen.userId;
      }
    }

    // No untried candidate in any ring → open the order to all online riders.
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        offeredRiderId: null,
        offerExpiresAt: null,
        dispatchExhausted: true,
        dispatchRadiusMeters: DispatchService.RINGS[DispatchService.RINGS.length - 1],
      },
    });
    return null;
  }

  /** Initialise dispatch state for a freshly-READY order, then make the first offer. */
  async startForOrder(orderId: string): Promise<string | null> {
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        dispatchRadiusMeters: DispatchService.RINGS[0],
        dispatchTriedRiderIds: [],
        dispatchExhausted: false,
        offeredRiderId: null,
        offerExpiresAt: null,
      },
    });
    return this.offerNext(orderId);
  }

  /**
   * Backstop sweep: re-offer every READY platform order whose offer has expired
   * (or was never made). Idempotent — safe to run on an interval.
   */
  async tick(): Promise<void> {
    const now = new Date();
    const stale = await this.prisma.order.findMany({
      where: {
        deliveryMode: DeliveryMode.PLATFORM_RIDER,
        status: OrderStatus.READY,
        riderId: null,
        bulkOrderId: null, // standalone orders only — bulk orders handled below
        dispatchExhausted: false,
        deletedAt: null,
        OR: [{ offeredRiderId: null }, { offerExpiresAt: { lte: now } }],
      },
      select: { id: true },
    });
    for (const o of stale) {
      await this.prisma.order.update({
        where: { id: o.id },
        data: { offeredRiderId: null, offerExpiresAt: null },
      });
      await this.offerNext(o.id);
    }

    // Sweep stale BulkOrder offers
    const staleBulk = await this.prisma.bulkOrder.findMany({
      where: {
        status: BulkOrderStatus.READY_ALL,
        riderId: null,
        dispatchExhausted: false,
        deletedAt: null,
        OR: [{ offeredRiderId: null }, { offerExpiresAt: { lte: now } }],
      },
      select: { id: true },
    });
    for (const b of staleBulk) {
      await this.prisma.bulkOrder.update({
        where: { id: b.id },
        data: { offeredRiderId: null, offerExpiresAt: null },
      });
      await this.offerNextForBulk(b.id);
    }
  }

  // ---- Bulk-order dispatch ----

  /**
   * Offer a BulkOrder to the nearest eligible rider, widening rings as usual.
   * Uses the anchor shop (first in sequence) as the pickup origin.
   */
  async offerNextForBulk(bulkOrderId: string): Promise<string | null> {
    const bulk = await this.prisma.bulkOrder.findFirst({
      where: {
        id: bulkOrderId,
        status: BulkOrderStatus.READY_ALL,
        riderId: null,
        deletedAt: null,
      },
      select: {
        id: true,
        dispatchTriedRiderIds: true,
        dispatchRadiusMeters: true,
        dispatchExhausted: true,
        orders: {
          take: 1,
          select: { shop: { select: { latitude: true, longitude: true, city: true } } },
        },
      },
    });
    if (!bulk || bulk.dispatchExhausted) return null;

    const anchorShop = bulk.orders[0]?.shop;
    if (!anchorShop?.latitude || !anchorShop?.longitude) return null;

    const shopGeo: LatLng = { lat: Number(anchorShop.latitude), lng: Number(anchorShop.longitude) };
    const shopCity = anchorShop.city;
    const tried = bulk.dispatchTriedRiderIds;
    const startRing = bulk.dispatchRadiusMeters ?? DispatchService.RINGS[0];
    const startIdx = Math.max(0, DispatchService.RINGS.indexOf(startRing));

    for (let i = startIdx; i < DispatchService.RINGS.length; i += 1) {
      const radius = DispatchService.RINGS[i];
      const candidates = await this.candidatesFor(shopGeo, shopCity, tried, radius);
      if (candidates.length > 0) {
        const chosen = candidates[0];
        await this.prisma.bulkOrder.update({
          where: { id: bulkOrderId },
          data: {
            offeredRiderId: chosen.userId,
            offerExpiresAt: new Date(Date.now() + DispatchService.OFFER_TTL_MS),
            dispatchTriedRiderIds: { push: chosen.userId },
            dispatchRadiusMeters: radius,
          },
        });
        void this.webPush.sendToUser(chosen.userId, {
          title: '🛵 Bulk delivery job!',
          body: 'A multi-shop delivery near you is ready. Tap to accept.',
          tag: `bulk-${bulkOrderId}`,
          url: '/',
        });
        this.realtime.emitJobOffered(chosen.userId, { orderId: bulkOrderId });
        return chosen.userId;
      }
    }

    await this.prisma.bulkOrder.update({
      where: { id: bulkOrderId },
      data: {
        offeredRiderId: null,
        offerExpiresAt: null,
        dispatchExhausted: true,
        dispatchRadiusMeters: DispatchService.RINGS[DispatchService.RINGS.length - 1],
      },
    });
    return null;
  }

  /** Initialise dispatch state for a READY_ALL BulkOrder and make the first offer. */
  async startForBulkOrder(bulkOrderId: string): Promise<string | null> {
    await this.prisma.bulkOrder.update({
      where: { id: bulkOrderId },
      data: {
        dispatchRadiusMeters: DispatchService.RINGS[0],
        dispatchTriedRiderIds: [],
        dispatchExhausted: false,
        offeredRiderId: null,
        offerExpiresAt: null,
      },
    });
    return this.offerNextForBulk(bulkOrderId);
  }

  // ---- Generic seam (future service categories) — still deferred ----
  /** Step 1: find nearby available providers (Phase: services). */
  findCandidates(_request: DispatchRequest): Promise<DispatchCandidate[]> {
    throw new NotImplementedException('dispatch.findCandidates — deferred (services phase)');
  }

  /** Steps 2–4: run the time-boxed offer loop and return the assignee. */
  dispatch(_request: DispatchRequest): Promise<{ providerId: string }> {
    throw new NotImplementedException('dispatch.dispatch — deferred (services phase)');
  }
}
