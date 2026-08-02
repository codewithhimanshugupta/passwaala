import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  LedgerEntryStatus,
  LedgerEntryType,
  OrderStatus,
  PRODUCT_ONBOARDING_FEE_PAISE,
  VerificationStatus,
  computeGst,
} from '@passwaala/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationQuery, cursorArgs, toPage } from '../common/pagination';
import { resolveAdminCity } from '../common/admin-city';
import { DashboardPeriod } from './dashboard-query.dto';
import { DisputesService } from '../disputes/disputes.service';
import { decryptOtp } from '../auth/credentials.util';
import { ReviewShopDto } from './dto/review-shop.dto';

/**
 * AdminService — shop approval / KYC review (plan → Shop Onboarding, Admin
 * Panel). ADMIN/OWNER only (enforced by @Roles on the controller).
 *
 * HARD RULES:
 *  - KYC docs are the crown jewels: only this admin-only surface returns them,
 *    and every view is AUDIT-LOGGED (who saw which shop's KYC, when).
 *  - Approving a shop starts the 1-month commission holiday (commissionFreeUntil)
 *    and writes the ₹499 onboarding fee as a ledger entry (base + 18% GST).
 *  - Rejecting requires a reason (shown to the shopkeeper to re-submit).
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly disputes: DisputesService,
  ) {}

  /** List shops awaiting review (PENDING_REVIEW), oldest first. */
  async listPendingShops() {
    return this.prisma.shop.findMany({
      where: { verificationStatus: VerificationStatus.PENDING_REVIEW, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        shopCategory: true,
        storefrontPhotoUrl: true,
        createdAt: true,
      },
    });
  }

  /**
   * List ALL shops (optionally filtered by city) with their config — for the
   * admin console to manage commission/status per shop without copying IDs.
   */
  async listAllShops(city?: string) {
    const shops = await this.prisma.shop.findMany({
      where: {
        deletedAt: null,
        ...(city ? { city: { equals: city, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ city: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        shortId: true,
        name: true,
        shopCategory: true,
        city: true,
        verificationStatus: true,
        isOpen: true,
        commissionRate: true,
        outstandingDuesPaise: true,
        creditLimitPaise: true,
        contactPhone: true,
        // Owner's backup login OTP (decrypted below) so admin can help a
        // locked-out shopkeeper sign in.
        owner: { select: { loginOtpEnc: true } },
      },
    });
    return shops.map(({ owner, ...shop }) => ({
      ...shop,
      ownerLoginOtp: decryptOtp(owner?.loginOtpEnc) ?? null,
    }));
  }

  /**
   * Admin-only: view a shop's KYC + documents. AUDIT-LOGGED — this is the
   * crown-jewels access path (plan → Security: audit privileged KYC views).
   */
  async viewKyc(adminUserId: string, shopId: string) {
    const kyc = await this.prisma.shopKyc.findFirst({
      where: { shopId, deletedAt: null },
    });
    if (!kyc) {
      throw new NotFoundException('KYC not found for this shop');
    }
    // Audit trail: who viewed which shop's KYC, when. (Phase 4 persists this to
    // a dedicated audit table + tamper-evident store; Phase 1 emits the record.)
    this.logger.log(
      `AUDIT kyc.view admin=${adminUserId} shop=${shopId} at=${new Date().toISOString()}`,
    );
    return kyc;
  }

  /** Approve a shop → APPROVED, start commission holiday, write onboarding fee. */
  async approve(adminUserId: string, shopId: string) {
    const shop = await this.requirePending(shopId);

    // 1-month commission holiday from approval (plan → Revenue Model).
    const commissionFreeUntil = new Date();
    commissionFreeUntil.setMonth(commissionFreeUntil.getMonth() + 1);

    // ₹499 onboarding fee + 18% GST. Recorded as PAID (upfront, paid directly
    // to PassWaala at approval) so it does NOT consume the shop's credit limit —
    // only commission + platform fees accrue against the limit (plan clarified).
    const fee = computeGst(PRODUCT_ONBOARDING_FEE_PAISE);

    const [updated] = await this.prisma.$transaction([
      this.prisma.shop.update({
        where: { id: shop.id },
        data: {
          verificationStatus: VerificationStatus.APPROVED,
          commissionFreeUntil,
        },
      }),
      this.prisma.ledgerEntry.create({
        data: {
          shopId: shop.id,
          type: LedgerEntryType.ONBOARDING_FEE,
          basePaise: fee.basePaise,
          gstPaise: fee.gstPaise,
          totalPaise: fee.totalPaise,
          status: LedgerEntryStatus.PAID, // paid upfront — not outstanding dues
        },
      }),
      // NOTE: outstandingDues is deliberately NOT incremented here.
    ]);

    this.logger.log(
      `AUDIT shop.approve admin=${adminUserId} shop=${shopId} at=${new Date().toISOString()}`,
    );
    return { verificationStatus: updated.verificationStatus };
  }

  /** Reject a shop → REJECTED with a reason (shown to the shopkeeper). */
  async reject(adminUserId: string, shopId: string, dto: ReviewShopDto) {
    if (!dto.reason) {
      throw new BadRequestException('A rejection reason is required');
    }
    await this.requirePending(shopId);
    await this.prisma.shop.update({
      where: { id: shopId },
      data: { verificationStatus: VerificationStatus.REJECTED },
    });
    this.logger.log(
      `AUDIT shop.reject admin=${adminUserId} shop=${shopId} reason="${dto.reason}"`,
    );
    return { verificationStatus: VerificationStatus.REJECTED };
  }

  /** Suspend a shop → SUSPENDED (instantly hides it). Any non-deleted shop. */
  async suspend(adminUserId: string, shopId: string) {
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, deletedAt: null },
      select: { id: true },
    });
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }
    await this.prisma.shop.update({
      where: { id: shopId },
      data: { verificationStatus: VerificationStatus.SUSPENDED },
    });
    this.logger.log(`AUDIT shop.suspend admin=${adminUserId} shop=${shopId}`);
    return { verificationStatus: VerificationStatus.SUSPENDED };
  }

  /**
   * Reactivate a suspended shop → APPROVED. Only works on SUSPENDED shops so an
   * admin can't accidentally bypass the KYC process for a DRAFT shop.
   */
  async reactivate(adminUserId: string, shopId: string) {
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, deletedAt: null },
      select: { id: true, verificationStatus: true },
    });
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }
    if (shop.verificationStatus !== VerificationStatus.SUSPENDED) {
      throw new BadRequestException('Only a SUSPENDED shop can be reactivated');
    }
    await this.prisma.shop.update({
      where: { id: shopId },
      data: { verificationStatus: VerificationStatus.APPROVED, isOpen: false },
    });
    this.logger.log(`AUDIT shop.reactivate admin=${adminUserId} shop=${shopId}`);
    return { verificationStatus: VerificationStatus.APPROVED };
  }

  /**
   * Owner/platform dashboard: cross-shop aggregate stats (plan → Admin Panel).
   * GMV = sum of delivered order totals; revenue = sum of PassWaala's
   * GST-inclusive ledger dues.
   *
   * The Summary block stays global + all-time. The Order Status widget's
   * `statusCounts` are scoped to the admin's assigned city (OWNER = all cities)
   * and to the selected time `period` (orders created since the period start).
   */
  async dashboard(adminId: string, role: string, period: DashboardPeriod) {
    const city = await resolveAdminCity(this.prisma, adminId, role);

    // Period window start (server-local time). null (Yearly falls back to a
    // real Jan-1 boundary) — undefined `start` means no lower bound.
    const now = new Date();
    let start: Date | undefined;
    switch (period) {
      case DashboardPeriod.Today:
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case DashboardPeriod.Weekly:
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case DashboardPeriod.Monthly:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case DashboardPeriod.Yearly:
        start = new Date(now.getFullYear(), 0, 1);
        break;
    }

    const statusWhere = {
      deletedAt: null,
      ...(start ? { createdAt: { gte: start } } : {}),
      ...(city ? { shop: { is: { city } } } : {}),
    };

    const [shops, activeShops, orders, deliveredAgg, revenueAgg, refundPending, statusGroups] =
      await Promise.all([
        this.prisma.shop.count({ where: { deletedAt: null } }),
        this.prisma.shop.count({
          where: { deletedAt: null, verificationStatus: VerificationStatus.APPROVED },
        }),
        this.prisma.order.count({ where: { deletedAt: null } }),
        this.prisma.order.aggregate({
          where: { deletedAt: null, status: OrderStatus.DELIVERED },
          _sum: { originalTotalPaise: true },
          _count: { _all: true },
        }),
        this.prisma.ledgerEntry.aggregate({
          // Only sum the revenue-generating types. PAYMENT and REFERRAL_CREDIT
          // are stored as negative paise and would make the total go negative.
          where: {
            deletedAt: null,
            type: { in: [LedgerEntryType.ONBOARDING_FEE, LedgerEntryType.COMMISSION, LedgerEntryType.PLATFORM_FEE] },
          },
          _sum: { totalPaise: true },
        }),
        this.prisma.order.count({
          where: { deletedAt: null, status: OrderStatus.REFUND_PENDING },
        }),
        this.prisma.order.groupBy({
          by: ['status'],
          where: statusWhere,
          _count: { _all: true },
        }),
      ]);

    // Zero-fill every status, then fold into the six dashboard buckets.
    const byStatus: Record<string, number> = {};
    for (const g of statusGroups) byStatus[g.status] = g._count._all;
    const sum = (...statuses: OrderStatus[]) =>
      statuses.reduce((acc, s) => acc + (byStatus[s] ?? 0), 0);
    const statusCounts = {
      pending: sum(OrderStatus.PLACED, OrderStatus.ACCEPTED, OrderStatus.AWAITING_PAYMENT),
      processing: sum(
        OrderStatus.PREPARING,
        OrderStatus.READY,
        OrderStatus.RIDER_ASSIGNED,
        OrderStatus.OUT_FOR_DELIVERY,
      ),
      completed: sum(OrderStatus.DELIVERED),
      cancelled: sum(OrderStatus.REJECTED, OrderStatus.CANCELLED),
      refundPending: sum(OrderStatus.REFUND_PENDING),
      refunded: sum(OrderStatus.REFUNDED),
    };

    return {
      shops,
      activeShops,
      totalOrders: orders,
      deliveredOrders: deliveredAgg._count._all,
      gmvPaise: deliveredAgg._sum.originalTotalPaise ?? 0,
      passwalaRevenuePaise: revenueAgg._sum.totalPaise ?? 0,
      refundPendingCount: refundPending,
      statusCounts,
    };
  }

  /**
   * Admin/owner: disputed orders — CANCELLED or REFUND_PENDING — newest first,
   * keyset paginated. Surfaces the reason + who cancelled + shop/customer so an
   * admin can investigate payment/fulfilment disputes (the only per-order admin
   * view; the rest of the panel is shop-level aggregates).
   */
  async disputedOrders(page: PaginationQuery = {}) {
    const rows = await this.prisma.order.findMany({
      where: {
        deletedAt: null,
        status: { in: [OrderStatus.CANCELLED, OrderStatus.REFUND_PENDING] },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(page.limit, page.cursor),
      select: {
        id: true,
        shortId: true,
        status: true,
        cancelledBy: true,
        cancellationReason: true,
        rejectionReason: true,
        paymentMethod: true,
        originalTotalPaise: true,
        adjustedTotalPaise: true,
        createdAt: true,
        updatedAt: true,
        shop: { select: { id: true, name: true, city: true } },
      },
    });
    const { items, nextCursor } = toPage(rows, page.limit);
    return {
      items: items.map((o) => ({
        orderId: o.id,
        orderNumber: o.shortId ?? `OR${o.id.replace(/-/g,'').slice(0,8).toUpperCase()}`,
        status: o.status,
        cancelledBy: o.cancelledBy,
        reason: o.cancellationReason ?? o.rejectionReason ?? null,
        paymentMethod: o.paymentMethod,
        totalPaise: o.adjustedTotalPaise ?? o.originalTotalPaise,
        shop: o.shop,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
      })),
      nextCursor,
    };
  }

  /**
   * Admin/owner: set a shop's commission rate (plan → per-shop commission,
   * admin-editable, applies to FUTURE orders only since past orders snapshot the
   * rate). rate is a decimal fraction (0.02 = 2%), clamped to [0, 0.5].
   */
  async setCommissionRate(adminUserId: string, shopId: string, rate: number) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 0.5) {
      throw new BadRequestException('commissionRate must be between 0 and 0.5');
    }
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, deletedAt: null },
      select: { id: true },
    });
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }
    await this.prisma.shop.update({ where: { id: shopId }, data: { commissionRate: rate } });
    this.logger.log(`AUDIT shop.commissionRate admin=${adminUserId} shop=${shopId} rate=${rate}`);
    return { commissionRate: rate };
  }

  /**
   * All platform riders with their profile + contact + COD dues, for the admin
   * riders console. Newest-registered first.
   */
  async listRiders(city?: string) {
    const profiles = await this.prisma.riderProfile.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        userId: true,
        vehicle: true,
        online: true,
        earningsPaise: true,
        duesPaise: true,
        creditLimitPaise: true,
        user: { select: { name: true, phone: true, loginOtpEnc: true } },
      },
    });

    // Fetch active orders for each rider in one query
    const riderIds = profiles.map((p) => p.userId);
    const activeOrders = riderIds.length
      ? await this.prisma.order.findMany({
          where: {
            riderId: { in: riderIds },
            status: { in: ['RIDER_ASSIGNED', 'OUT_FOR_DELIVERY'] },
            deletedAt: null,
          },
          select: {
            id: true,
            riderId: true,
            status: true,
            originalTotalPaise: true,
            adjustedTotalPaise: true,
            paymentMethod: true,
            shop: { select: { name: true } },
          },
        })
      : [];

    const ordersByRider: Record<string, typeof activeOrders> = {};
    for (const o of activeOrders) {
      if (!o.riderId) continue;
      if (!ordersByRider[o.riderId]) ordersByRider[o.riderId] = [];
      ordersByRider[o.riderId].push(o);
    }

    // Total + today's completed deliveries per rider
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [totalCounts, todayCounts, cityRows] = await Promise.all([
      riderIds.length ? this.prisma.order.groupBy({
        by: ['riderId'],
        where: { riderId: { in: riderIds }, status: 'DELIVERED', deletedAt: null },
        _count: { _all: true },
      }) : [],
      riderIds.length ? this.prisma.order.groupBy({
        by: ['riderId'],
        where: { riderId: { in: riderIds }, status: 'DELIVERED', deletedAt: null, updatedAt: { gte: todayStart } },
        _count: { _all: true },
      }) : [],
      // Riders have no city field of their own; derive the city they operate in
      // from the shops on their orders (any status). Used for the city filter.
      riderIds.length ? this.prisma.order.findMany({
        where: { riderId: { in: riderIds }, deletedAt: null },
        select: { riderId: true, shop: { select: { city: true } } },
      }) : [],
    ]);

    const totalMap: Record<string, number> = {};
    for (const r of totalCounts) if (r.riderId) totalMap[r.riderId] = r._count._all;
    const todayMap: Record<string, number> = {};
    for (const r of todayCounts) if (r.riderId) todayMap[r.riderId] = r._count._all;

    // Distinct operating cities per rider (from their orders' shops).
    const citiesByRider: Record<string, Set<string>> = {};
    for (const row of cityRows) {
      const c = row.shop?.city;
      if (!row.riderId || !c) continue;
      (citiesByRider[row.riderId] ??= new Set()).add(c);
    }

    const cityFilter = city?.trim().toLowerCase();
    const result = profiles.map((p) => ({
      userId: p.userId,
      name: p.user?.name ?? null,
      phone: p.user?.phone ?? null,
      loginOtp: decryptOtp(p.user?.loginOtpEnc) ?? null,
      vehicle: p.vehicle ?? null,
      online: p.online,
      earningsPaise: p.earningsPaise,
      duesPaise: p.duesPaise,
      creditLimitPaise: p.creditLimitPaise,
      totalDeliveries: totalMap[p.userId] ?? 0,
      todayDeliveries: todayMap[p.userId] ?? 0,
      cities: Array.from(citiesByRider[p.userId] ?? []).sort(),
      activeOrders: (ordersByRider[p.userId] ?? []).map((o) => ({
        orderId: o.id,
        orderRef: o.id.slice(0, 8).toUpperCase(),
        status: o.status,
        shopName: o.shop?.name ?? null,
        totalPaise: o.adjustedTotalPaise ?? o.originalTotalPaise,
        paymentMethod: o.paymentMethod,
      })),
    }));

    // City filter: keep riders who have at least one order in a shop in that city.
    return cityFilter
      ? result.filter((r) => r.cities.some((c) => c.toLowerCase() === cityFilter))
      : result;
  }

  /**
   * Record that a rider has deposited their collected COD cash → zero their
   * dues (mirrors the shop recordPayment settlement). Audit-logged.
   */
  async recordRiderPayment(adminUserId: string, riderUserId: string) {
    const profile = await this.prisma.riderProfile.findUnique({
      where: { userId: riderUserId },
      select: { duesPaise: true },
    });
    if (!profile) {
      throw new NotFoundException('Rider not found');
    }
    const clearedPaise = profile.duesPaise;
    await this.prisma.riderProfile.update({
      where: { userId: riderUserId },
      data: { duesPaise: 0 },
    });
    this.logger.log(
      `AUDIT rider.recordPayment admin=${adminUserId} rider=${riderUserId} cleared=${clearedPaise}`,
    );
    return { settled: true, clearedPaise };
  }

  /** Load a shop that must currently be PENDING_REVIEW, or throw. */
  private async requirePending(shopId: string) {
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, deletedAt: null },
      select: { id: true, verificationStatus: true },
    });
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }
    if (shop.verificationStatus !== VerificationStatus.PENDING_REVIEW) {
      throw new BadRequestException(
        `Shop is not pending review (status ${shop.verificationStatus})`,
      );
    }
    return shop;
  }

  /** Admin: all orders across the platform — live and completed. Includes OTPs
   *  and payment state so the admin can verify any order end-to-end. */
  async listAllOrders(page: PaginationQuery = {}, status?: string) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (status) where.status = status;
    const rows = await this.prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(page.limit, page.cursor),
      select: {
        id: true,
        shortId: true,
        status: true,
        paymentMethod: true,
        deliveryMode: true,
        originalTotalPaise: true,
        adjustedTotalPaise: true,
        platformFeePaise: true,
        deliveryFeePaise: true,
        paymentConfirmed: true,
        paymentClaimedAt: true,
        codUpiClaimedAt: true,
        cancelledBy: true,
        cancellationReason: true,
        rejectionReason: true,
        pickupOtp: true,
        riderPickupOtp: true,
        createdAt: true,
        updatedAt: true,
        shop: { select: { id: true, shortId: true, name: true, city: true } },
        customer: { select: { id: true, shortId: true, name: true, phone: true } },
        rider: { select: { id: true, shortId: true, name: true, phone: true } },
        items: { select: { nameSnapshot: true, qty: true, pricePaiseSnapshot: true, status: true } },
      },
    });
    const { items, nextCursor } = toPage(rows, page.limit);
    return {
      items: items.map((o) => ({
        orderId: o.id,
        orderNumber: o.shortId ?? `OR${o.id.replace(/-/g,'').slice(0,8).toUpperCase()}`,
        status: o.status,
        paymentMethod: o.paymentMethod,
        deliveryMode: o.deliveryMode,
        totalPaise: o.adjustedTotalPaise ?? o.originalTotalPaise,
        platformFeePaise: o.platformFeePaise,
        deliveryFeePaise: o.deliveryFeePaise,
        paymentConfirmed: o.paymentConfirmed,
        paymentClaimedAt: o.paymentClaimedAt?.toISOString() ?? null,
        codUpiClaimedAt: o.codUpiClaimedAt?.toISOString() ?? null,
        cancelledBy: o.cancelledBy,
        reason: o.cancellationReason ?? o.rejectionReason ?? null,
        pickupOtp: o.pickupOtp,
        riderPickupOtp: o.riderPickupOtp,
        shop: o.shop,
        customer: o.customer ? { id: o.customer.id, shortId: o.customer.shortId, name: o.customer.name, phone: o.customer.phone } : null,
        rider: o.rider ? { id: o.rider.id, shortId: o.rider.shortId, name: o.rider.name, phone: o.rider.phone } : null,
        items: o.items,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
      })),
      nextCursor,
    };
  }

  /**
   * Admin taskboard: pending items that need human attention + recent automation
   * log (what the system did automatically, with revert capability).
   */
  async getTaskboard() {
    const [pendingKyc, pendingClaims, refundPending, pausedShops, automationLog] =
      await Promise.all([
        // Shops awaiting KYC review
        this.prisma.shop.findMany({
          where: { verificationStatus: 'PENDING_REVIEW', deletedAt: null },
          select: { id: true, name: true, city: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
        // Pending payment claims (shops + riders)
        this.prisma.paymentClaim.findMany({
          where: { status: 'PENDING' },
          select: { id: true, entityType: true, shopId: true, riderUserId: true, amountPaise: true, claimedAt: true },
          orderBy: { claimedAt: 'asc' },
        }),
        // Orders stuck in REFUND_PENDING
        this.prisma.order.findMany({
          where: { status: 'REFUND_PENDING', deletedAt: null },
          select: { id: true, originalTotalPaise: true, adjustedTotalPaise: true, shop: { select: { id: true, name: true } }, createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
        // Shops paused due to credit limit
        this.prisma.shop.findMany({
          where: { isOpen: false, deletedAt: null, outstandingDuesPaise: { gt: 0 } },
          select: { id: true, name: true, outstandingDuesPaise: true, creditLimitPaise: true, updatedAt: true },
          orderBy: { updatedAt: 'asc' },
        }),
        // Recent automation actions (last 100, unreversed first)
        this.prisma.automationLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            id: true, action: true, detail: true,
            orderId: true, shopId: true, riderUserId: true,
            revertedAt: true, revertedById: true, revertNote: true,
            createdAt: true,
          },
        }),
      ]);

    // Resolve shop/rider names for claims
    const claimShopIds = [...new Set(pendingClaims.filter(c => c.shopId).map(c => c.shopId!))];
    const claimRiderIds = [...new Set(pendingClaims.filter(c => c.riderUserId).map(c => c.riderUserId!))];
    const [claimShops, claimRiders] = await Promise.all([
      claimShopIds.length ? this.prisma.shop.findMany({ where: { id: { in: claimShopIds } }, select: { id: true, name: true } }) : [],
      claimRiderIds.length ? this.prisma.user.findMany({ where: { id: { in: claimRiderIds } }, select: { id: true, name: true, phone: true } }) : [],
    ]);
    const shopNameMap = Object.fromEntries(claimShops.map(s => [s.id, s.name]));
    const riderMap = Object.fromEntries(claimRiders.map(r => [r.id, r.name ?? r.phone ?? r.id]));

    // Build flat taskboard items sorted oldest-first
    type TaskItem =
      | { type: 'KYC'; shopId: string; shopName: string; city: string | null; since: string }
      | { type: 'PAYMENT_CLAIM'; claimId: string; entityType: string; entityName: string; amountPaise: number; since: string }
      | { type: 'REFUND'; orderId: string; orderRef: string; shopName: string; amountPaise: number; since: string }
      | { type: 'SHOP_PAUSED'; shopId: string; shopName: string; duesPaise: number; limitPaise: number; since: string };

    const items: TaskItem[] = [
      ...pendingKyc.map(s => ({ type: 'KYC' as const, shopId: s.id, shopName: s.name, city: s.city, since: s.createdAt.toISOString() })),
      ...pendingClaims.map(c => ({
        type: 'PAYMENT_CLAIM' as const,
        claimId: c.id,
        entityType: c.entityType,
        entityName: c.shopId ? (shopNameMap[c.shopId] ?? c.shopId) : (c.riderUserId ? (riderMap[c.riderUserId] ?? c.riderUserId) : '?'),
        amountPaise: c.amountPaise,
        since: c.claimedAt.toISOString(),
      })),
      ...refundPending.map(o => ({
        type: 'REFUND' as const,
        orderId: o.id,
        orderRef: o.id.slice(0, 8).toUpperCase(),
        shopName: o.shop?.name ?? '?',
        amountPaise: o.adjustedTotalPaise ?? o.originalTotalPaise,
        since: o.createdAt.toISOString(),
      })),
      ...pausedShops.map(s => ({
        type: 'SHOP_PAUSED' as const,
        shopId: s.id,
        shopName: s.name,
        duesPaise: s.outstandingDuesPaise,
        limitPaise: s.creditLimitPaise,
        since: s.updatedAt.toISOString(),
      })),
    ].sort((a, b) => a.since.localeCompare(b.since));

    return {
      summary: {
        pendingKyc: pendingKyc.length,
        pendingClaims: pendingClaims.length,
        refundPending: refundPending.length,
        pausedShops: pausedShops.length,
      },
      items,
      automationLog: automationLog.map(l => ({
        id: l.id,
        action: l.action,
        detail: l.detail,
        orderId: l.orderId ?? null,
        shopId: l.shopId ?? null,
        riderUserId: l.riderUserId ?? null,
        revertedAt: l.revertedAt?.toISOString() ?? null,
        revertedById: l.revertedById ?? null,
        revertNote: l.revertNote ?? null,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Revert an automation action. The system undoes the side-effect based on
   * the action type, then marks the log entry as reverted.
   */
  async revertAutomation(logId: string, adminId: string, note?: string) {
    const log = await this.prisma.automationLog.findFirst({
      where: { id: logId, revertedAt: null },
    });
    if (!log) throw new NotFoundException('Automation log not found or already reverted');

    switch (log.action) {
      case 'ORDER_AUTO_CANCELLED':
        if (log.orderId) {
          // Reopen: set status back to PLACED
          await this.prisma.order.update({
            where: { id: log.orderId },
            data: { status: 'PLACED', cancelledBy: null, cancellationReason: null, cancelledAt: null },
          });
        }
        break;
      case 'SHOP_AUTO_PAUSED':
      case 'SHOP_AUTO_CLOSED':
        if (log.shopId) {
          await this.prisma.shop.update({ where: { id: log.shopId }, data: { isOpen: true } });
        }
        break;
      case 'SHOP_AUTO_OPENED':
        if (log.shopId) {
          await this.prisma.shop.update({ where: { id: log.shopId }, data: { isOpen: false } });
        }
        break;
      case 'RIDER_EARNINGS_CREDITED':
        // Earnings revert not supported — money already recorded; admin should adjust manually
        throw new NotFoundException('Rider earnings entries cannot be auto-reverted — adjust manually');
      default:
        // For ORDER_REMIND, DISPATCH_RE_OFFERED — no side-effect to undo, just mark reverted
        break;
    }

    await this.prisma.automationLog.update({
      where: { id: logId },
      data: { revertedAt: new Date(), revertedById: adminId, revertNote: note ?? null },
    });
    this.logger.log(`AUDIT automation.revert admin=${adminId} logId=${logId} action=${log.action}`);
    return { reverted: true };
  }

  /**
   * Admin: force-cancel any non-terminal order. Records cancellation reason and
   * logs the action for audit. Cannot cancel terminal orders (DELIVERED /
   * REJECTED / CANCELLED / REFUND_PENDING).
   */
  async cancelOrder(adminId: string, orderId: string, reason: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const TERMINAL: OrderStatus[] = [
      OrderStatus.DELIVERED,
      OrderStatus.REJECTED,
      OrderStatus.CANCELLED,
      OrderStatus.REFUND_PENDING,
    ];
    if (TERMINAL.includes(order.status as OrderStatus)) {
      throw new BadRequestException(`Order is already in terminal state ${order.status}`);
    }
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledBy: 'ADMIN' as any,
        cancellationReason: reason,
        cancelledAt: new Date(),
      },
    });
    this.logger.log(`AUDIT admin.cancelOrder admin=${adminId} orderId=${orderId} reason=${reason}`);
    await this.disputes.openSystemDispute(orderId, `Order force-cancelled by admin — ${reason}`);
    return { cancelled: true };
  }

  /**
   * Admin: assign additional rider(s) to an order whose weight exceeds 20 kg.
   * The primary riderId is unchanged; this appends to additionalRiderIds.
   * Idempotent — re-adding an already-assigned rider is a no-op.
   */
  async assignAdditionalRiders(adminId: string, orderId: string, riderUserIds: string[]) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { id: true, status: true, additionalRiderIds: true, totalWeightGrams: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    // Validate all rider IDs exist and are riders
    const riders = await this.prisma.user.findMany({
      where: { id: { in: riderUserIds }, role: 'RIDER' },
      select: { id: true },
    });
    if (riders.length !== riderUserIds.length) {
      throw new BadRequestException('One or more rider IDs are invalid or not riders');
    }

    const existing = new Set(order.additionalRiderIds);
    for (const id of riderUserIds) existing.add(id);
    const merged = [...existing];

    await this.prisma.order.update({
      where: { id: orderId },
      data: { additionalRiderIds: merged },
    });
    this.logger.log(`AUDIT admin.assignAdditionalRiders admin=${adminId} orderId=${orderId} riders=${merged.join(',')}`);
    return { additionalRiderIds: merged };
  }
}
