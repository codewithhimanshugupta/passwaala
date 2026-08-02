import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DeliveryMode, OrderStatus, PaymentMethod, RiderLedgerType, UserRole } from '@passwaala/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { CitiesService } from '../cities/cities.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { LedgerService } from '../ledger/ledger.service';
import { RIDER_ORDER_SELECT } from '../orders/order-select';
import { PaginationQuery, cursorArgs, toPage } from '../common/pagination';
import { RegisterRiderDto, SetRiderOnlineDto } from './dto/rider.dto';

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
  ) {}

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
      data: { role: UserRole.RIDER, name: dto.name },
    });
    await this.prisma.riderProfile.upsert({
      where: { userId },
      create: { userId, vehicle: dto.vehicle },
      update: { vehicle: dto.vehicle },
    });
    const accessToken = await this.auth.signFor(userId, UserRole.RIDER);
    return { accessToken };
  }

  /** The caller's rider profile (online status, vehicle, earnings, dues). */
  async me(userId: string) {
    const profile = await this.prisma.riderProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new NotFoundException('Not registered as a rider');
    }
    // PassWaala's collection UPI so the rider can deposit their COD dues directly
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
    return {
      online: profile.online,
      vehicle: profile.vehicle,
      earningsPaise: profile.earningsPaise, // currently owed to the rider (net)
      lifetimeEarnedPaise: earnedAgg._sum.amountPaise ?? 0,
      lifetimePaidOutPaise: -(paidAgg._sum.amountPaise ?? 0), // stored negative
      duesPaise: profile.duesPaise,
      creditLimitPaise: profile.creditLimitPaise,
      collectionUpi,
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
          WHERE "deletedAt" IS NULL AND "isOpen" = true
          ORDER BY ST_Distance(
            ST_MakePoint(longitude::float8, latitude::float8)::geography,
            ST_MakePoint(${dto.longitude}::float8, ${dto.latitude}::float8)::geography
          )
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
    return { online: updated.online };
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
    return { ok: true };
  }

  /**
   * Jobs this rider may act on right now (online-gated): either the ONE order
   * currently offered to them (proximity dispatch, offer not yet expired), or —
   * once dispatch has exhausted all rings with no taker — any order on the open
   * board. Nearest-first isn't needed here (a rider sees only their own offer).
   */
  async availableJobs(userId: string) {
    const profile = await this.prisma.riderProfile.findUnique({ where: { userId }, select: { online: true } });
    if (!profile?.online) {
      return [];
    }
    const orders = await this.prisma.order.findMany({
      where: {
        deliveryMode: DeliveryMode.PLATFORM_RIDER,
        status: OrderStatus.READY,
        riderId: null,
        deletedAt: null,
        OR: [
          { offeredRiderId: userId, offerExpiresAt: { gt: new Date() } },
          { dispatchExhausted: true },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: RIDER_ORDER_SELECT,
    });
    return orders;
  }

  /**
   * The caller's ACTIVE deliveries only (claimed, not yet delivered). Small
   * bounded set (the active-order cap is 2), so no pagination — the Jobs screen
   * polls this to surface in-hand work.
   */
  async myDeliveries(userId: string) {
    return this.prisma.order.findMany({
      where: {
        riderId: userId,
        deletedAt: null,
        status: { in: [OrderStatus.RIDER_ASSIGNED, OrderStatus.OUT_FOR_DELIVERY] },
      },
      orderBy: { updatedAt: 'desc' },
      select: RIDER_ORDER_SELECT,
    });
  }

  /**
   * The caller's completed-delivery HISTORY (DELIVERED), newest first. Keyset
   * paginated — grows unbounded, so the Deliveries screen loads a page at a time.
   */
  async deliveryHistory(userId: string, page: PaginationQuery = {}) {
    const rows = await this.prisma.order.findMany({
      where: { riderId: userId, deletedAt: null, status: OrderStatus.DELIVERED },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(page.limit, page.cursor),
      select: RIDER_ORDER_SELECT,
    });
    return toPage(rows, page.limit);
  }

  /**
   * Claim an available job (first-come). Enforces the active-order cap (a rider
   * holds 1 order; a 2nd only if its drop is within the same-area radius of the
   * first), then atomically sets riderId only if still unclaimed + READY, moving
   * it RIDER_ASSIGNED (the rider must verify the shop's pickup OTP before it goes
   * OUT_FOR_DELIVERY).
   */
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
    this.realtime.emitOrderStatusChanged(order.shopId, { orderId, status: order.status as OrderStatus });
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
}
