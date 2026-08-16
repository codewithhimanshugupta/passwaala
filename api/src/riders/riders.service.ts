import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DeliveryMode, OrderStatus, PaymentMethod, RiderLedgerType, UserRole, BulkOrderStatus, haversineMeters } from '@nearbaz/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { CitiesService } from '../cities/cities.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { LedgerService } from '../ledger/ledger.service';
import { ReferralsService } from '../referrals/referrals.service';
import { RIDER_ORDER_SELECT } from '../orders/order-select';
import { PaginationQuery, cursorArgs, toPage } from '../common/pagination';
import { titleCaseName } from '../common/text.util';
import { RegisterRiderDto, SetRiderOnlineDto } from './dto/rider.dto';
import { WebPushService } from '../notifications/web-push.service';

/**
 * RidersService — the platform delivery network (plan → Delivery: designed for,
 * built later). A user becomes a RIDER, toggles online, sees available
 * PLATFORM_RIDER orders that are READY, claims one (first-come), then advances
 * pickup → delivered (with the customer's handoff OTP). Earnings accrue per
 * completed delivery.
 *
 * MVP-pragmatic: this is a claim-based job board, not the full geo-dispatch
 * offer/timeout loop (that broader engine stays in the deferred dispatch module).
 */
@Injectable()
export class RidersService {
  /** Max active orders a rider may hold at once. */
  private static readonly MAX_ACTIVE_ORDERS = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly dispatch: DispatchService,
    private readonly cities: CitiesService,
    private readonly realtime: RealtimeGateway,
    private readonly ledger: LedgerService,
    private readonly referrals: ReferralsService,
    private readonly webPush: WebPushService,
  ) {}

  /**
   * Fire an OS/web push to a shop's owner (best-effort, never blocks). Rider
   * events emit a socket update to the shop feed; this adds a background push
   * so a shopkeeper with the app closed / phone locked still gets alerted.
   */
  private async pushToShopOwner(
    shopId: string,
    payload: { title: string; body: string; tag?: string; url?: string },
  ): Promise<void> {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { id: shopId },
        select: { ownerId: true },
      });
      if (shop?.ownerId) await this.webPush.sendToUser(shop.ownerId, payload);
    } catch {
      /* best-effort — never break the rider action on a push failure */
    }
  }

  /** Register the caller as a RIDER (idempotent) + return a fresh RIDER token. */
  async register(userId: string, dto: RegisterRiderDto) {
    // Guard against a stale token whose user was removed (e.g. after a DB reset):
    // return a clean 401 so the app routes to login instead of a 500.
    const exists = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!exists) {
      throw new UnauthorizedException('Your session has expired. Please log in again.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { role: UserRole.RIDER, name: titleCaseName(dto.name) },
    });
    await this.prisma.riderProfile.upsert({
      where: { userId },
      create: { userId, vehicle: dto.vehicle, ...(dto.serviceCity ? { serviceCity: dto.serviceCity } : {}) },
      update: { vehicle: dto.vehicle, ...(dto.serviceCity ? { serviceCity: dto.serviceCity } : {}) },
    });
    // Persist KYC when any identity/document detail is supplied. Stored 1:1 with
    // the rider so admin can verify + pull records later (docs are admin-only).
    if (dto.fullName || dto.aadhaar || dto.dlNumber || (dto.docUrls && dto.docUrls.length)) {
      const kyc = {
        fullName: titleCaseName(dto.fullName ?? dto.name),
        aadhaar: dto.aadhaar ?? '',
        pan: dto.pan ?? null,
        dlNumber: dto.dlNumber ?? '',
        vehicleNumber: dto.vehicleNumber ?? null,
        emergencyName: dto.emergencyName ?? null,
        emergencyPhone: dto.emergencyPhone ?? null,
        photoUrl: dto.photoUrl ?? null,
        docUrls: dto.docUrls ?? [],
      };
      await this.prisma.riderKyc.upsert({
        where: { userId },
        create: { userId, ...kyc },
        update: kyc,
      });
    }
    const accessToken = await this.auth.signFor(userId, UserRole.RIDER);
    return { accessToken };
  }

  /** The caller's rider profile (online status, vehicle, earnings, dues). */
  async me(userId: string) {
    const profile = await this.prisma.riderProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new NotFoundException('Not registered as a rider');
    }
    // NearBaz's collection UPI so the rider can deposit their COD dues directly
    // (null when the owner hasn't configured one for any enabled city).
    const collectionUpi = await this.cities.getDefaultCollectionUpi();
    // Lifetime earnings breakdown from the rider ledger (running balance is the
    // net; these split it into earned vs paid-out for a clear statement).
    const [earnedAgg, paidAgg, recentLedger] = await Promise.all([
      this.prisma.riderLedger.aggregate({
        where: { riderUserId: userId, type: RiderLedgerType.DELIVERY_EARNING, deletedAt: null },
        _sum: { amountPaise: true },
      }),
      this.prisma.riderLedger.aggregate({
        where: { riderUserId: userId, type: RiderLedgerType.EARNING_PAYOUT, deletedAt: null },
        _sum: { amountPaise: true },
      }),
      this.prisma.riderLedger.findMany({
        where: { riderUserId: userId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, type: true, amountPaise: true, note: true, orderId: true, createdAt: true },
      }),
    ]);
    // The rider's city per-km delivery fee tiers (admin-configured on the
    // ServiceableCity). Parsed + sorted so the app can render them live instead
    // of hardcoding — additions/increases by the admin reflect on next fetch.
    const cityCfg = profile.serviceCity
      ? await this.prisma.serviceableCity.findFirst({
          where: { name: { equals: profile.serviceCity, mode: 'insensitive' } },
          select: { deliveryTiersJson: true },
        })
      : null;
    let deliveryTiers: Array<{ maxKm: number; feePaise: number }> = [];
    if (cityCfg?.deliveryTiersJson) {
      try {
        const parsed = JSON.parse(cityCfg.deliveryTiersJson);
        if (Array.isArray(parsed)) {
          deliveryTiers = parsed
            .filter(
              (tier): tier is { maxKm: number; feePaise: number } =>
                tier && typeof tier.maxKm === 'number' && typeof tier.feePaise === 'number',
            )
            .sort((a, b) => a.maxKm - b.maxKm);
        }
      } catch {
        /* leave empty on malformed config */
      }
    }
    return {
      online: profile.online,
      vehicle: profile.vehicle,
      earningsPaise: profile.earningsPaise, // currently owed to the rider (net)
      lifetimeEarnedPaise: earnedAgg._sum.amountPaise ?? 0,
      lifetimePaidOutPaise: -(paidAgg._sum.amountPaise ?? 0), // stored negative
      duesPaise: profile.duesPaise,
      creditLimitPaise: profile.creditLimitPaise,
      collectionUpi,
      serviceCity: profile.serviceCity,
      deliveryTiers,
      ledger: recentLedger,
    };
  }

  /**
   * Recent automation notifications for the rider — penalty alerts, stale order
   * releases, escalation notices. Returns the 10 most recent entries from the
   * automation log tagged with this rider's userId.
   */
  async recentNotifications(userId: string) {
    const logs = await this.prisma.automationLog.findMany({
      where: { riderUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, action: true, detail: true, createdAt: true, orderId: true },
    });
    return logs.map(l => ({
      id: l.id,
      action: l.action,
      message: l.detail,
      orderId: l.orderId,
      createdAt: l.createdAt.toISOString(),
      isWarning: l.action.includes('PENALTY') || l.action.includes('ESCALAT'),
    }));
  }

  /** Toggle online/offline + optionally update the rider's live location. */
  async setOnline(userId: string, dto: SetRiderOnlineDto) {
    const profile = await this.prisma.riderProfile.findUnique({
      where: { userId },
      select: { id: true, duesPaise: true, creditLimitPaise: true },
    });
    if (!profile) {
      throw new NotFoundException('Not registered as a rider');
    }
    if (dto.online) {
      // Dues gate: a rider at/over their COD cap can't go online.
      if (profile.duesPaise >= profile.creditLimitPaise) {
        throw new BadRequestException(
          'Your COD dues have reached the limit. Deposit collected cash to go online.',
        );
      }
      // Delivery tiers gate: city must have fee tiers configured before riders can operate.
      if (dto.latitude != null && dto.longitude != null) {
        const nearbyShop = await this.prisma.$queryRaw<Array<{ city: string }>>`
          SELECT city FROM "Shop"
          WHERE "deletedAt" IS NULL AND "isOpen" = true AND geog IS NOT NULL
          ORDER BY geog <-> ST_SetSRID(ST_MakePoint(${dto.longitude}::float8, ${dto.latitude}::float8), 4326)::geography
          LIMIT 1
        `;
        const riderCity = nearbyShop[0]?.city;
        if (riderCity) {
          const cityConfig = await this.prisma.serviceableCity.findFirst({
            where: {
              deletedAt: null,
              enabled: true,
              OR: [
                { name: { equals: riderCity, mode: 'insensitive' } },
                { name: { contains: riderCity.split(',')[0].trim(), mode: 'insensitive' } },
              ],
            },
            select: { deliveryTiersJson: true },
          });
          if (!cityConfig?.deliveryTiersJson) {
            throw new BadRequestException(
              'Delivery fee tiers are not configured for your city. Contact the admin to set up delivery pricing before going online.',
            );
          }
        }
      }
    }
    const updated = await this.prisma.riderProfile.update({
      where: { userId },
      data: {
        online: dto.online,
        latitude: dto.latitude,
        longitude: dto.longitude,
      },
      select: { online: true },
    });
    // Maintain the GIST-indexed geog column so proximity checks stay index-backed.
    if (dto.latitude != null && dto.longitude != null) {
      await this.syncRiderGeog(userId, dto.longitude, dto.latitude);
    }
    return { online: updated.online };
  }

  /** Maintain the PostGIS geog point on RiderProfile from lon/lat (raw SQL — Unsupported type). */
  private async syncRiderGeog(userId: string, longitude: number, latitude: number): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE "RiderProfile" SET geog = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE "userId" = $3`,
      longitude,
      latitude,
      userId,
    );
  }

  /**
   * Update the rider's live position (a GPS ping sent while on an active
   * delivery, without toggling online). Lets the customer's tracking map follow
   * the rider toward the drop.
   */
  async updateLocation(userId: string, latitude: number, longitude: number) {
    const profile = await this.prisma.riderProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) {
      throw new NotFoundException('Not registered as a rider');
    }
    await this.prisma.riderProfile.update({
      where: { userId },
      data: { latitude, longitude },
    });
    await this.syncRiderGeog(userId, longitude, latitude);
    return { ok: true };
  }

  /**
   * Jobs this rider may act on right now (online-gated): either the ONE order
   * currently offered to them (proximity dispatch, offer not yet expired), or —
   * once dispatch has exhausted all rings with no taker — any order on the open
   * board. Nearest-first isn't needed here (a rider sees only their own offer).
   */
  async availableJobs(userId: string) {
    const profile = await this.prisma.riderProfile.findUnique({
      where: { userId },
      select: { online: true, serviceCity: true },
    });
    if (!profile?.online) {
      return { orders: [], bulkOrders: [] };
    }
    const [orders, bulkOrders] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          deliveryMode: DeliveryMode.PLATFORM_RIDER,
          status: OrderStatus.READY,
          riderId: null,
          bulkOrderId: null, // standalone only — bulk handled separately
          deletedAt: null,
          shop: { city: profile.serviceCity },
          OR: [
            { offeredRiderId: userId, offerExpiresAt: { gt: new Date() } },
            { dispatchExhausted: true },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: RIDER_ORDER_SELECT,
      }),
      this.prisma.bulkOrder.findMany({
        where: {
          status: BulkOrderStatus.READY_ALL,
          riderId: null,
          deletedAt: null,
          orders: { some: { shop: { city: profile.serviceCity } } },
          OR: [
            { offeredRiderId: userId, offerExpiresAt: { gt: new Date() } },
            { dispatchExhausted: true },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          shortId: true,
          status: true,
          paymentMethod: true,
          totalPaise: true,
          baseDeliveryFeePaise: true,
          multiShopSurchargePaise: true,
          offerExpiresAt: true,
          dispatchExhausted: true,
          createdAt: true,
          address: { select: { line: true, landmark: true, latitude: true, longitude: true } },
          orders: {
            select: {
              id: true,
              shopId: true,
              originalTotalPaise: true,
              items: { select: { nameSnapshot: true, qty: true } },
              shop: { select: { name: true, addressLine: true, city: true, latitude: true, longitude: true, upiVpa: true } },
            },
          },
        },
      }),
    ]);
    return { orders, bulkOrders };
  }

  /**
   * The caller's ACTIVE deliveries only (claimed, not yet delivered). Small
   * bounded set (the active-order cap is 2), so no pagination — the Jobs screen
   * polls this to surface in-hand work.
   */
  async myDeliveries(userId: string) {
    const [orders, bulkOrders] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          riderId: userId,
          bulkOrderId: null, // standalone only
          deletedAt: null,
          status: { in: [OrderStatus.RIDER_ASSIGNED, OrderStatus.OUT_FOR_DELIVERY] },
        },
        orderBy: { updatedAt: 'desc' },
        select: RIDER_ORDER_SELECT,
      }),
      this.prisma.bulkOrder.findMany({
        where: {
          riderId: userId,
          deletedAt: null,
          status: {
            in: [
              BulkOrderStatus.RIDER_ASSIGNED,
              BulkOrderStatus.PICKING_UP,
              BulkOrderStatus.OUT_FOR_DELIVERY,
            ],
          },
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          shortId: true,
          status: true,
          paymentMethod: true,
          totalPaise: true,
          baseDeliveryFeePaise: true,
          multiShopSurchargePaise: true,
          pickupSequenceJson: true,
          pickupOtp: true,
          createdAt: true,
          updatedAt: true,
          address: { select: { line: true, landmark: true, latitude: true, longitude: true } },
          orders: {
            select: {
              id: true,
              shopId: true,
              status: true,
              originalTotalPaise: true,
              riderPickupOtp: true,
              codUpiClaimedAt: true,
              paymentConfirmed: true,
              items: { select: { nameSnapshot: true, qty: true } },
              shop: { select: { name: true, addressLine: true, city: true, latitude: true, longitude: true, upiVpa: true } },
            },
          },
        },
      }),
    ]);
    return { orders, bulkOrders };
  }

  /**
   * The caller's completed-delivery HISTORY (DELIVERED), newest first. Keyset
   * paginated — grows unbounded, so the Deliveries screen loads a page at a time.
   * Includes both standalone orders AND completed bulk-order envelopes.
   */
  async deliveryHistory(userId: string, page: PaginationQuery = {}) {
    const [orders, bulkOrders] = await Promise.all([
      this.prisma.order.findMany({
        where: { riderId: userId, bulkOrderId: null, deletedAt: null, status: OrderStatus.DELIVERED },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(page.limit, page.cursor),
        select: RIDER_ORDER_SELECT,
      }),
      this.prisma.bulkOrder.findMany({
        where: { riderId: userId, deletedAt: null, status: BulkOrderStatus.DELIVERED },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: (page.limit ?? 20) + 1,
        ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
        select: {
          id: true, shortId: true, status: true, paymentMethod: true,
          totalPaise: true, baseDeliveryFeePaise: true, multiShopSurchargePaise: true,
          createdAt: true, updatedAt: true,
          address: { select: { line: true, landmark: true, latitude: true, longitude: true } },
          orders: {
            select: {
              id: true, shopId: true, originalTotalPaise: true,
              items: { select: { nameSnapshot: true, qty: true } },
              shop: { select: { name: true, addressLine: true, city: true, latitude: true, longitude: true } },
            },
          },
        },
      }),
    ]);
    return {
      orders: toPage(orders, page.limit).items,
      ordersNextCursor: toPage(orders, page.limit).nextCursor,
      bulkOrders,
    };
  }

  /**
   * Claim the order currently OFFERED to this rider (proximity dispatch), or any
   * order on the open board once dispatch has exhausted all rings. Enforces the
   * dues gate + active-order cap, then atomically sets riderId only if still
   * unclaimed + READY and the offer/open-board guard holds, moving it
   * RIDER_ASSIGNED (the rider verifies the shop's pickup OTP before OUT_FOR_DELIVERY).
   */
  async accept(userId: string, orderId: string) {
    // Dues gate: a rider at/over their COD cap can't take new orders until an
    // admin clears their dues (mirrors the shop credit-limit gate).
    const me = await this.prisma.riderProfile.findUnique({
      where: { userId },
      select: { duesPaise: true, creditLimitPaise: true },
    });
    if (me && me.duesPaise >= me.creditLimitPaise) {
      throw new BadRequestException(
        'Clear your COD dues before taking new orders. Deposit the cash you have collected.',
      );
    }
    // Active-order cap: a rider may hold at most MAX_ACTIVE_ORDERS at once.
    const activeCount = await this.prisma.order.count({
      where: {
        riderId: userId,
        status: { in: [OrderStatus.RIDER_ASSIGNED, OrderStatus.OUT_FOR_DELIVERY] },
        deletedAt: null,
      },
    });
    if (activeCount >= RidersService.MAX_ACTIVE_ORDERS) {
      throw new BadRequestException('You already have the maximum active orders. Finish one first.');
    }

    // Atomic claim, guarded by dispatch: only the currently-offered rider (offer
    // not expired) may take it — unless dispatch has opened it to everyone.
    const claimed = await this.prisma.order.updateMany({
      where: {
        id: orderId,
        deliveryMode: DeliveryMode.PLATFORM_RIDER,
        status: OrderStatus.READY,
        riderId: null,
        deletedAt: null,
        OR: [
          { offeredRiderId: userId, offerExpiresAt: { gt: new Date() } },
          { dispatchExhausted: true },
        ],
      },
      data: {
        riderId: userId,
        status: OrderStatus.RIDER_ASSIGNED,
        offeredRiderId: null,
        offerExpiresAt: null,
      },
    });
    if (claimed.count === 0) {
      throw new BadRequestException('This job is no longer available to you.');
    }
    return { accepted: true };
  }

  /**
   * Decline the order currently offered to this rider → mark them tried and clear
   * the offer so dispatch re-offers it to the next-nearest rider immediately.
   */
  async decline(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, offeredRiderId: userId, status: OrderStatus.READY, riderId: null, deletedAt: null },
      select: { id: true, dispatchTriedRiderIds: true },
    });
    if (!order) {
      // Nothing to decline (already reassigned/expired) — treat as a no-op.
      return { declined: true };
    }
    const tried = order.dispatchTriedRiderIds.includes(userId)
      ? order.dispatchTriedRiderIds
      : [...order.dispatchTriedRiderIds, userId];
    await this.prisma.order.update({
      where: { id: orderId },
      data: { offeredRiderId: null, offerExpiresAt: null, dispatchTriedRiderIds: tried },
    });
    // Re-offer to the next-nearest right away (the sweep is the backstop).
    await this.dispatch.offerNext(orderId).catch(() => undefined);
    return { declined: true };
  }

  /**
   * Confirm pickup at the shop: the rider enters the pickup OTP shown in the
   * shopkeeper app. Moves a RIDER_ASSIGNED order OUT_FOR_DELIVERY. Scoped to the
   * rider's own claimed order. No earnings here — those accrue on delivery.
   */
  async confirmPickup(userId: string, orderId: string, otp: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, riderId: userId, deletedAt: null },
      select: { id: true, status: true, riderPickupOtp: true },
    });
    if (!order) {
      throw new NotFoundException('Delivery not found');
    }
    if (order.status !== OrderStatus.RIDER_ASSIGNED) {
      throw new BadRequestException(`Cannot confirm pickup from status ${order.status}`);
    }
    if (order.riderPickupOtp) {
      if (!otp || !otp.trim()) throw new BadRequestException("Enter the shop’s pickup OTP to collect the order");
      if (otp.trim() !== order.riderPickupOtp) throw new BadRequestException("Wrong OTP — ask the shop for the correct 4-digit code");
    }
    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.OUT_FOR_DELIVERY },
    });
    return { status: OrderStatus.OUT_FOR_DELIVERY };
  }

  /**
   * Rider records that the customer paid a COD order by scanning the shop's UPI
   * QR at the door. This is a CLAIM — the money went straight to the shop, so
   * the SHOP must confirm receipt (paymentConfirmed) before the rider can mark
   * the order DELIVERED. Scoped to the rider's own OUT_FOR_DELIVERY COD order.
   */
  async claimUpiPaid(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, riderId: userId, deletedAt: null },
      select: { id: true, status: true, shopId: true, paymentMethod: true },
    });
    if (!order) {
      throw new NotFoundException('Delivery not found');
    }
    if (order.paymentMethod !== PaymentMethod.COD) {
      throw new BadRequestException('Only a COD order can be marked paid by UPI at the door');
    }
    if (order.status !== OrderStatus.OUT_FOR_DELIVERY) {
      throw new BadRequestException(`Cannot claim payment from status ${order.status}`);
    }
    await this.prisma.order.update({
      where: { id: orderId },
      data: { codUpiClaimedAt: new Date() },
    });
    // Nudge the shop's feed to confirm they received the UPI payment.
    this.realtime.emitOrderShopUpdate(order.shopId, { orderId, status: order.status as OrderStatus });
    void this.pushToShopOwner(order.shopId, {
      title: 'Confirm UPI payment',
      body: 'The rider marked this COD order paid by UPI. Confirm you received it.',
      tag: `order-${orderId}`,
      url: `/orders/${orderId}`,
    });
    return { claimed: true };
  }

  /**
   * Rider marks their delivery DELIVERED — requires the customer's handoff OTP.
   * Credits the rider's flat earnings. For a COD order the rider chose how the
   * customer paid: CASH → the collected amount is added to the rider's dues
   * (owed onward); QR/UPI (`codPaidViaUpi`) → the customer paid the shop's UPI
   * directly (no dues), but the SHOP must have CONFIRMED receipt first. UPI
   * orders always add nothing. Scoped to orders assigned to this rider.
   */
  async completeDelivery(userId: string, orderId: string, otp: string, codPaidViaUpi = false) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, riderId: userId, deletedAt: null },
      select: {
        id: true,
        status: true,
        pickupOtp: true,
        paymentMethod: true,
        paymentConfirmed: true,
        originalTotalPaise: true,
        adjustedTotalPaise: true,
        deliveryFeePaise: true,
      },
    });
    if (!order) {
      throw new NotFoundException('Delivery not found');
    }
    if (order.status !== OrderStatus.OUT_FOR_DELIVERY) {
      throw new BadRequestException(`Cannot complete from status ${order.status}`);
    }
    if (order.pickupOtp) {
      if (!otp || !otp.trim()) throw new BadRequestException("Enter the customer’s handoff OTP to complete the delivery");
      if (otp.trim() !== order.pickupOtp) throw new BadRequestException("Wrong OTP — ask the customer for the correct 4-digit code");
    }
    const paidViaUpi = order.paymentMethod === PaymentMethod.COD && codPaidViaUpi;
    // A QR/UPI-paid COD order can only be completed once the SHOP has confirmed
    // it received the money (paymentConfirmed) — the payment went to the shop,
    // not the rider, so the rider can't self-attest it.
    if (paidViaUpi && !order.paymentConfirmed) {
      throw new BadRequestException('Waiting for the shop to confirm they received the UPI payment.');
    }
    // COD paid by CASH → the rider holds the cash, which becomes a due. QR/UPI
    // and prepaid UPI orders add nothing.
    const isCodCash = order.paymentMethod === PaymentMethod.COD && !codPaidViaUpi;
    const collectedPaise = isCodCash
      ? order.adjustedTotalPaise ?? order.originalTotalPaise
      : 0;
    // Rider earns exactly the delivery fee the shop set (passed straight through).
    const earnedPaise = order.deliveryFeePaise;
    // Rider ledger history rows (audit trail alongside the running balances).
    const riderLedgerRows: Array<{ type: RiderLedgerType; amountPaise: number; note: string }> = [];
    if (earnedPaise > 0) {
      riderLedgerRows.push({ type: RiderLedgerType.DELIVERY_EARNING, amountPaise: earnedPaise, note: 'Delivery fee earned' });
    }
    if (collectedPaise > 0) {
      riderLedgerRows.push({ type: RiderLedgerType.COD_COLLECTED, amountPaise: collectedPaise, note: 'COD cash collected' });
    }
    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.DELIVERED },
      }),
      this.prisma.riderProfile.update({
        where: { userId },
        data: {
          earningsPaise: { increment: earnedPaise },
          ...(collectedPaise > 0 ? { duesPaise: { increment: collectedPaise } } : {}),
        },
      }),
      ...riderLedgerRows.map((r) =>
        this.prisma.riderLedger.create({
          data: { riderUserId: userId, orderId, type: r.type, amountPaise: r.amountPaise, note: r.note },
        }),
      ),
    ]);
    // Accrue commission + platform fee to the shop's ledger — same as shopkeeper-driven delivery.
    await this.ledger.accrueOnDelivery(orderId);
    return {
      status: OrderStatus.DELIVERED,
      earnedPaise,
      collectedPaise,
    };
  }

  /**
   * Admin pays out a rider's accrued delivery earnings. Decrements earningsPaise
   * (the ONLY place it goes down) and writes an EARNING_PAYOUT ledger row for the
   * audit trail. Amount is capped at the rider's current earnings balance.
   */
  async payEarnings(riderUserId: string, amountPaise: number, adminUserId: string) {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      throw new BadRequestException('Payout amount must be a positive whole number of paise');
    }
    const profile = await this.prisma.riderProfile.findUnique({
      where: { userId: riderUserId },
      select: { earningsPaise: true },
    });
    if (!profile) {
      throw new NotFoundException('Rider not found');
    }
    if (amountPaise > profile.earningsPaise) {
      throw new BadRequestException(`Payout exceeds the ₹${profile.earningsPaise / 100} owed to this rider`);
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.riderProfile.update({
        where: { userId: riderUserId },
        data: { earningsPaise: { decrement: amountPaise } },
        select: { earningsPaise: true },
      }),
      this.prisma.riderLedger.create({
        data: {
          riderUserId,
          type: RiderLedgerType.EARNING_PAYOUT,
          amountPaise: -amountPaise,
          note: `Earnings paid out by admin ${adminUserId}`,
        },
      }),
      this.prisma.automationLog.create({
        data: {
          action: 'RIDER_EARNING_PAYOUT',
          detail: `Paid ₹${amountPaise / 100} earnings to rider`,
          riderUserId,
        },
      }),
    ]);
    return { paid: true, newEarningsPaise: updated.earningsPaise };
  }

  // ── Bulk-order rider operations ─────────────────────────────────────────────

  /** Accept a BulkOrder (proximity offer or open board). */
  async acceptBulk(userId: string, bulkOrderId: string) {
    const me = await this.prisma.riderProfile.findUnique({
      where: { userId },
      select: { duesPaise: true, creditLimitPaise: true, latitude: true, longitude: true },
    });
    if (me && me.duesPaise >= me.creditLimitPaise) {
      throw new BadRequestException('Clear your COD dues before taking new orders.');
    }
    // Active-order cap: a BulkOrder counts as 1
    const activeCount = await this.prisma.order.count({
      where: {
        riderId: userId,
        status: { in: [OrderStatus.RIDER_ASSIGNED, OrderStatus.OUT_FOR_DELIVERY] },
        bulkOrderId: null,
        deletedAt: null,
      },
    });
    const activeBulkCount = await this.prisma.bulkOrder.count({
      where: {
        riderId: userId,
        status: { in: [BulkOrderStatus.RIDER_ASSIGNED, BulkOrderStatus.PICKING_UP, BulkOrderStatus.OUT_FOR_DELIVERY] },
        deletedAt: null,
      },
    });
    if (activeCount + activeBulkCount >= RidersService.MAX_ACTIVE_ORDERS) {
      throw new BadRequestException('You already have the maximum active orders. Finish one first.');
    }

    // Compute pickup sequence from rider's current location (nearest shop first)
    const bulk = await this.prisma.bulkOrder.findFirst({
      where: {
        id: bulkOrderId,
        status: BulkOrderStatus.READY_ALL,
        riderId: null,
        deletedAt: null,
        OR: [
          { offeredRiderId: userId, offerExpiresAt: { gt: new Date() } },
          { dispatchExhausted: true },
        ],
      },
      select: {
        id: true,
        orders: {
          select: { id: true, shop: { select: { latitude: true, longitude: true } } },
        },
      },
    });
    if (!bulk) throw new BadRequestException('This bulk job is no longer available to you.');

    // Sort shops nearest-first from rider's current position
    const riderLat = me?.latitude != null ? Number(me.latitude) : NaN;
    const riderLng = me?.longitude != null ? Number(me.longitude) : NaN;
    const sorted = [...bulk.orders].sort((a, b) => {
      if (!Number.isFinite(riderLat) || !Number.isFinite(riderLng)) return 0;
      const da = haversineMeters(
        { latitude: riderLat, longitude: riderLng },
        { latitude: a.shop?.latitude, longitude: a.shop?.longitude },
      );
      const db = haversineMeters(
        { latitude: riderLat, longitude: riderLng },
        { latitude: b.shop?.latitude, longitude: b.shop?.longitude },
      );
      return da - db;
    });
    const pickupSequenceJson = JSON.stringify(sorted.map((o) => o.id));

    // Atomic claim
    const claimed = await this.prisma.bulkOrder.updateMany({
      where: {
        id: bulkOrderId,
        status: BulkOrderStatus.READY_ALL,
        riderId: null,
        deletedAt: null,
        OR: [
          { offeredRiderId: userId, offerExpiresAt: { gt: new Date() } },
          { dispatchExhausted: true },
        ],
      },
      data: {
        riderId: userId,
        status: BulkOrderStatus.RIDER_ASSIGNED,
        pickupSequenceJson,
        offeredRiderId: null,
        offerExpiresAt: null,
      },
    });
    if (claimed.count === 0) throw new BadRequestException('This bulk job is no longer available to you.');

    // Mark all sub-orders RIDER_ASSIGNED
    await this.prisma.order.updateMany({
      where: { bulkOrderId, deletedAt: null },
      data: { riderId: userId, status: OrderStatus.RIDER_ASSIGNED },
    });

    // Notify customer their bulk order has a rider assigned
    const cust = await this.prisma.bulkOrder.findUnique({ where: { id: bulkOrderId }, select: { customerId: true } });
    if (cust) {
      this.realtime.emitOrderStatusChanged(cust.customerId, { orderId: bulkOrderId, status: 'RIDER_ASSIGNED' });
      void this.webPush.sendToUser(cust.customerId, {
        title: 'Rider assigned',
        body: 'A delivery partner is on the way to pick up your order.',
        tag: `bulk-${bulkOrderId}`,
        url: `/orders/${bulkOrderId}`,
      });
    }

    return { accepted: true, pickupSequenceJson };
  }

  /** Decline a BulkOrder offer → re-offer to next rider. */
  async declineBulk(userId: string, bulkOrderId: string) {
    const bulk = await this.prisma.bulkOrder.findFirst({
      where: { id: bulkOrderId, offeredRiderId: userId, status: BulkOrderStatus.READY_ALL, riderId: null, deletedAt: null },
      select: { id: true, dispatchTriedRiderIds: true },
    });
    if (!bulk) return { declined: true };
    const tried = bulk.dispatchTriedRiderIds.includes(userId)
      ? bulk.dispatchTriedRiderIds
      : [...bulk.dispatchTriedRiderIds, userId];
    await this.prisma.bulkOrder.update({
      where: { id: bulkOrderId },
      data: { offeredRiderId: null, offerExpiresAt: null, dispatchTriedRiderIds: tried },
    });
    await this.dispatch.offerNextForBulk(bulkOrderId).catch(() => undefined);
    return { declined: true };
  }

  /**
   * Confirm pickup at one shop in the bulk run. The rider enters the
   * riderPickupOtp shown on that shop's screen. Moves the sub-order
   * RIDER_ASSIGNED → OUT_FOR_DELIVERY. When ALL sub-orders are picked up,
   * the BulkOrder becomes OUT_FOR_DELIVERY.
   */
  async confirmBulkPickup(userId: string, subOrderId: string, otp: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: subOrderId, riderId: userId, deletedAt: null },
      select: { id: true, status: true, riderPickupOtp: true, bulkOrderId: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (!order.bulkOrderId) throw new BadRequestException('Not a bulk sub-order');
    if (order.status !== OrderStatus.RIDER_ASSIGNED) {
      throw new BadRequestException(`Cannot confirm pickup from status ${order.status}`);
    }
    if (order.riderPickupOtp) {
      if (!otp?.trim()) throw new BadRequestException("Enter the shop's pickup OTP");
      if (otp.trim() !== order.riderPickupOtp) throw new BadRequestException("Wrong OTP — ask the shop for the correct 4-digit code");
    }
    await this.prisma.order.update({
      where: { id: subOrderId },
      data: { status: OrderStatus.OUT_FOR_DELIVERY },
    });

    // Advance BulkOrder envelope stage
    await this.advanceBulkStage(order.bulkOrderId);

    const bulk = await this.prisma.bulkOrder.findUnique({ where: { id: order.bulkOrderId }, select: { customerId: true, status: true } });
    if (bulk) {
      this.realtime.emitOrderStatusChanged(bulk.customerId, { orderId: order.bulkOrderId, status: bulk.status });
      void this.webPush.sendToUser(bulk.customerId, {
        title: 'Order on the way',
        body: 'Your rider has picked up an order and is heading to you.',
        tag: `bulk-${order.bulkOrderId}`,
        url: `/orders/${order.bulkOrderId}`,
      });
    }

    return { status: OrderStatus.OUT_FOR_DELIVERY };
  }

  /**
   * Complete the bulk delivery — rider enters the single customer handoff OTP
   * (same OTP on the BulkOrder, shared across all sub-orders). Marks every
   * sub-order DELIVERED and the BulkOrder DELIVERED. Credits earnings.
   */
  async completeBulkDelivery(userId: string, bulkOrderId: string, otp: string, codPaidViaUpi = false) {
    const bulk = await this.prisma.bulkOrder.findFirst({
      where: { id: bulkOrderId, riderId: userId, deletedAt: null },
      select: {
        id: true, status: true, pickupOtp: true, paymentMethod: true, totalPaise: true,
        baseDeliveryFeePaise: true, multiShopSurchargePaise: true, customerId: true,
        orders: { select: { id: true, status: true, paymentMethod: true, paymentConfirmed: true } },
      },
    });
    if (!bulk) throw new NotFoundException('Bulk delivery not found');
    if (bulk.status !== BulkOrderStatus.OUT_FOR_DELIVERY) {
      throw new BadRequestException(`Cannot complete from status ${bulk.status}`);
    }
    if (bulk.pickupOtp) {
      if (!otp?.trim()) throw new BadRequestException("Enter the customer's handoff OTP");
      if (otp.trim() !== bulk.pickupOtp) throw new BadRequestException("Wrong OTP — ask the customer for the correct 4-digit code");
    }
    const paidViaUpi = bulk.paymentMethod === PaymentMethod.COD && codPaidViaUpi;
    if (paidViaUpi && !bulk.orders.every((o) => o.paymentConfirmed)) {
      throw new BadRequestException('Waiting for all shops to confirm they received the UPI payment.');
    }
    const isCodCash = bulk.paymentMethod === PaymentMethod.COD && !codPaidViaUpi;
    const collectedPaise = isCodCash ? bulk.totalPaise : 0;
    const earnedPaise = bulk.baseDeliveryFeePaise + bulk.multiShopSurchargePaise;

    await this.prisma.$transaction([
      // Deliver all sub-orders
      this.prisma.order.updateMany({
        where: { bulkOrderId, deletedAt: null },
        data: { status: OrderStatus.DELIVERED },
      }),
      // Deliver the BulkOrder envelope
      this.prisma.bulkOrder.update({
        where: { id: bulkOrderId },
        data: { status: BulkOrderStatus.DELIVERED },
      }),
      // Rider earnings
      this.prisma.riderProfile.update({
        where: { userId },
        data: {
          earningsPaise: { increment: earnedPaise },
          ...(collectedPaise > 0 ? { duesPaise: { increment: collectedPaise } } : {}),
        },
      }),
      this.prisma.riderLedger.create({
        data: { riderUserId: userId, type: RiderLedgerType.DELIVERY_EARNING, amountPaise: earnedPaise, note: `Bulk delivery fee earned (${bulk.id})` },
      }),
      ...(collectedPaise > 0 ? [this.prisma.riderLedger.create({
        data: { riderUserId: userId, type: RiderLedgerType.COD_COLLECTED, amountPaise: collectedPaise, note: `COD cash collected for bulk ${bulk.id}` },
      })] : []),
    ]);

    // Accrue ledger for each sub-order
    for (const subOrder of bulk.orders) {
      await this.ledger.accrueOnDelivery(subOrder.id).catch(() => undefined);
    }

    // Notify customer the bulk order is delivered
    const customerId = bulk.customerId;
    this.realtime.emitOrderStatusChanged(customerId, { orderId: bulkOrderId, status: BulkOrderStatus.DELIVERED });
    void this.webPush.sendToUser(customerId, {
      title: 'Order delivered',
      body: 'Your order has been delivered. Enjoy!',
      tag: `bulk-${bulkOrderId}`,
      url: `/orders/${bulkOrderId}`,
    });

    // Qualify referral for the customer (first bulk delivery counts as a qualifying order)
    await this.referrals.qualifyOnDelivery(customerId).catch(() => undefined);

    return { status: BulkOrderStatus.DELIVERED, earnedPaise, collectedPaise };
  }

  async claimBulkSubOrderUpiPaid(userId: string, subOrderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: subOrderId, riderId: userId, bulkOrderId: { not: null }, deletedAt: null },
      select: { id: true, status: true, shopId: true, paymentMethod: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.paymentMethod !== PaymentMethod.COD) throw new BadRequestException('Only COD orders');
    if (order.status !== OrderStatus.OUT_FOR_DELIVERY) throw new BadRequestException(`Cannot claim from status ${order.status}`);
    await this.prisma.order.update({ where: { id: subOrderId }, data: { codUpiClaimedAt: new Date() } });
    this.realtime.emitOrderShopUpdate(order.shopId, { orderId: subOrderId, status: order.status as OrderStatus });
    void this.pushToShopOwner(order.shopId, {
      title: 'Confirm UPI payment',
      body: 'The rider marked this COD order paid by UPI. Confirm you received it.',
      tag: `order-${subOrderId}`,
      url: `/orders/${subOrderId}`,
    });
    return { claimed: true };
  }

  private async advanceBulkStage(bulkOrderId: string): Promise<void> {
    const bulk = await this.prisma.bulkOrder.findUnique({
      where: { id: bulkOrderId },
      select: { id: true, status: true, orders: { select: { status: true } } },
    });
    if (!bulk) return;
    const allPickedUp = bulk.orders.every((o) => o.status === OrderStatus.OUT_FOR_DELIVERY);
    if (allPickedUp) {
      await this.prisma.bulkOrder.update({
        where: { id: bulkOrderId },
        data: { status: BulkOrderStatus.OUT_FOR_DELIVERY },
      });
    } else if (bulk.status === BulkOrderStatus.RIDER_ASSIGNED) {
      await this.prisma.bulkOrder.update({
        where: { id: bulkOrderId },
        data: { status: BulkOrderStatus.PICKING_UP },
      });
    }
  }
}
