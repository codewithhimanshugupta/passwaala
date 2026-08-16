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
  async listPendingShops(adminId?: string, role?: string) {
    // City-first: a city admin only reviews shops in their own city (OWNER = all).
    const city = adminId ? await resolveAdminCity(this.prisma, adminId, role ?? '') : null;
    return this.prisma.shop.findMany({
      where: {
        ...(city ? { city: { equals: city, mode: 'insensitive' } } : {}),
        verificationStatus: VerificationStatus.PENDING_REVIEW,
        deletedAt: null,
      },
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
   * List ALL shops (city-scoped) with their config — for the admin console to
   * manage commission/status per shop without copying IDs. City is the FIRST
   * filter: a city admin sees only their city; an OWNER sees all (or may pass a
   * city query to narrow). Keeps the list fast as the platform grows.
   */
  async listAllShops(adminId?: string, role?: string, cityQuery?: string) {
    const scopedCity = adminId ? await resolveAdminCity(this.prisma, adminId, role ?? '') : null;
    const city = scopedCity ?? cityQuery;
    const shops = await this.prisma.shop.findMany({
      where: {
        ...(city ? { city: { equals: city, mode: 'insensitive' } } : {}),
        deletedAt: null,
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
        appealMessage: true,
        appealSubmittedAt: true,
        owner: { select: { loginOtpEnc: true, loginPinEnc: true } },
      },
    });

    const shopIds = shops.map((s) => s.id);

    // Per-shop order stats — two groupBys, each a single DB round-trip.
    const [statusGroups, gmvGroups, revenueGroups] = await Promise.all([
      // Active + total counts per shop
      this.prisma.order.groupBy({
        by: ['shopId', 'status'],
        where: { deletedAt: null, shopId: { in: shopIds } },
        _count: { _all: true },
      }),
      // Delivered GMV per shop
      this.prisma.order.groupBy({
        by: ['shopId'],
        where: { deletedAt: null, status: OrderStatus.DELIVERED, shopId: { in: shopIds } },
        _sum: { originalTotalPaise: true },
        _count: { _all: true },
      }),
      // Commission/platform-fee revenue per shop
      this.prisma.ledgerEntry.groupBy({
        by: ['shopId'],
        where: {
          deletedAt: null,
          shopId: { in: shopIds },
          type: { in: [LedgerEntryType.COMMISSION, LedgerEntryType.PLATFORM_FEE] },
        },
        _sum: { totalPaise: true },
      }),
    ]);

    const ACTIVE_STATUSES = new Set([
      OrderStatus.PLACED, OrderStatus.ACCEPTED, OrderStatus.AWAITING_PAYMENT,
      OrderStatus.PREPARING, OrderStatus.READY,
      OrderStatus.RIDER_ASSIGNED, OrderStatus.OUT_FOR_DELIVERY,
    ]);
    // Build lookup maps: shopId → aggregated stats
    type StatusMap = Map<string, number>;
    const byShopStatus = new Map<string, StatusMap>();
    for (const g of statusGroups) {
      if (!g.shopId) continue;
      if (!byShopStatus.has(g.shopId)) byShopStatus.set(g.shopId, new Map());
      byShopStatus.get(g.shopId)!.set(g.status, g._count._all);
    }
    const gmvByShop = new Map(gmvGroups.map((g) => [g.shopId, { paise: g._sum.originalTotalPaise ?? 0, count: g._count._all }]));
    const revByShop = new Map(revenueGroups.map((g) => [g.shopId, g._sum.totalPaise ?? 0]));

    return shops.map(({ owner, ...shop }) => {
      const statusMap = byShopStatus.get(shop.id) ?? new Map<string, number>();
      let activeOrders = 0;
      let totalOrders = 0;
      let refundPending = 0;
      for (const [status, count] of statusMap) {
        totalOrders += count;
        if (ACTIVE_STATUSES.has(status as OrderStatus)) activeOrders += count;
        if (status === OrderStatus.REFUND_PENDING) refundPending += count;
      }
      const gmv = gmvByShop.get(shop.id) ?? { paise: 0, count: 0 };
      return {
        ...shop,
        ownerLoginOtp: decryptOtp(owner?.loginOtpEnc) ?? null,
        ownerLoginPin: decryptOtp(owner?.loginPinEnc) ?? null,
        activeOrders,
        totalOrders,
        deliveredOrders: gmv.count,
        gmvPaise: gmv.paise,
        revenuePaise: revByShop.get(shop.id) ?? 0,
        refundPending,
        appealMessage: shop.appealMessage ?? null,
        appealSubmittedAt: shop.appealSubmittedAt?.toISOString() ?? null,
      };
    });
  }

  /**
   * Admin: full shop detail — all config fields, KYC, products with stock,
   * and a recent-orders slice. Single endpoint so the detail modal needs one
   * round-trip.
   */
  async shopDetail(adminUserId: string, shopId: string) {
    const [shop, kyc, products, recentOrders] = await Promise.all([
      this.prisma.shop.findFirst({
        where: { id: shopId, deletedAt: null },
        select: {
          id: true, shortId: true, name: true, shopCategory: true, city: true,
          addressLine: true, contactPhone: true, storefrontPhotoUrl: true,
          logoUrl: true, bannerUrl: true, upiVpa: true, gstin: true,
          legalName: true, stateCode: true,
          latitude: true, longitude: true,
          verificationStatus: true, isOpen: true,
          commissionRate: true, commissionFreeUntil: true,
          creditLimitPaise: true, outstandingDuesPaise: true,
          minOrderValuePaise: true, deliveryFeePaise: true,
          freeDeliveryAbovePaise: true, platformDeliveryEnabled: true,
          selfPickupEnabled: true, offerText: true, workingHours: true,
          avgRating: true, ratingCount: true,
          createdAt: true, updatedAt: true,
          owner: { select: { loginOtpEnc: true, loginPinEnc: true } },
        },
      }),
      this.prisma.shopKyc.findFirst({
        where: { shopId, deletedAt: null },
        select: { aadhaarPan: true, gstOrLicence: true, fssai: true, bankProofUrl: true, docUrls: true, createdAt: true },
      }),
      this.prisma.product.findMany({
        where: { shopId, deletedAt: null },
        orderBy: [{ available: 'desc' }, { orderCount: 'desc' }, { name: 'asc' }],
        select: {
          id: true, name: true, pricePaise: true, mrpPaise: true,
          stock: true, available: true, orderCount: true,
          imageUrl: true, categoryId: true,
          createdAt: true,
        },
      }),
      this.prisma.order.findMany({
        where: { shopId, deletedAt: null },
        orderBy: [{ createdAt: 'desc' }],
        take: 20,
        select: {
          id: true, shortId: true, status: true, originalTotalPaise: true,
          adjustedTotalPaise: true, paymentMethod: true, deliveryMode: true,
          cancellationReason: true, rejectionReason: true, createdAt: true,
          customer: { select: { name: true, phone: true } },
          items: { select: { nameSnapshot: true, qty: true } },
        },
      }),
    ]);

    if (!shop) throw new NotFoundException('Shop not found');

    this.logger.log(`AUDIT shop.detail admin=${adminUserId} shop=${shopId} at=${new Date().toISOString()}`);

    const { owner, ...shopFields } = shop;
    return {
      ...shopFields,
      ownerLoginOtp: decryptOtp(owner?.loginOtpEnc) ?? null,
      ownerLoginPin: decryptOtp(owner?.loginPinEnc) ?? null,
      kyc,
      products,
      recentOrders: recentOrders.map((o) => ({
        orderId: o.id,
        orderNumber: o.shortId ?? `OR${o.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
        status: o.status,
        totalPaise: o.adjustedTotalPaise ?? o.originalTotalPaise,
        paymentMethod: o.paymentMethod,
        deliveryMode: o.deliveryMode,
        reason: o.cancellationReason ?? o.rejectionReason ?? null,
        customer: o.customer ? { name: o.customer.name, phone: o.customer.phone } : null,
        itemCount: o.items.reduce((s, it) => s + it.qty, 0),
        createdAt: o.createdAt.toISOString(),
      })),
    };
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

    // Look up city config for commission holiday days + onboarding fee + default commission rate.
    const cityCfg = shop.city ? await this.prisma.serviceableCity.findFirst({
      where: { name: { equals: shop.city, mode: 'insensitive' }, deletedAt: null },
      select: { commissionHolidayDays: true, onboardingFeePaise: true, defaultCommissionRate: true, defaultCreditLimitPaise: true },
    }) : null;

    const holidayDays = cityCfg?.commissionHolidayDays ?? 30;
    const commissionFreeUntil = new Date(Date.now() + holidayDays * 24 * 60 * 60 * 1000);

    const onboardingBase = cityCfg?.onboardingFeePaise ?? PRODUCT_ONBOARDING_FEE_PAISE;
    const fee = computeGst(onboardingBase);

    const updateData: Record<string, unknown> = {
      verificationStatus: VerificationStatus.APPROVED,
      commissionFreeUntil,
    };
    if (cityCfg?.defaultCommissionRate !== undefined) updateData.commissionRate = cityCfg.defaultCommissionRate;
    if (cityCfg?.defaultCreditLimitPaise !== undefined) updateData.creditLimitPaise = cityCfg.defaultCreditLimitPaise;

    const [updated] = await this.prisma.$transaction([
      this.prisma.shop.update({ where: { id: shop.id }, data: updateData }),
      this.prisma.ledgerEntry.create({
        data: {
          shopId: shop.id,
          type: LedgerEntryType.ONBOARDING_FEE,
          basePaise: fee.basePaise,
          gstPaise: fee.gstPaise,
          totalPaise: fee.totalPaise,
          status: LedgerEntryStatus.PAID,
        },
      }),
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
   * GMV = sum of delivered order totals; revenue = sum of NearBaz's
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

  /** Admin: enable or disable COD for a specific shop. */
  async setCodEnabled(adminUserId: string, shopId: string, enabled: boolean) {
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, deletedAt: null },
      select: { id: true },
    });
    if (!shop) throw new NotFoundException('Shop not found');
    await this.prisma.shop.update({ where: { id: shopId }, data: { codEnabled: enabled } });
    this.logger.log(`AUDIT shop.codEnabled admin=${adminUserId} shop=${shopId} enabled=${enabled}`);
    return { codEnabled: enabled };
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
        serviceCity: true,
        online: true,
        earningsPaise: true,
        duesPaise: true,
        creditLimitPaise: true,
        user: { select: { name: true, phone: true, loginOtpEnc: true, loginPinEnc: true } },
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
      loginPin: decryptOtp(p.user?.loginPinEnc) ?? null,
      vehicle: p.vehicle ?? null,
      serviceCity: p.serviceCity ?? null,
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

    // City filter: keep riders whose serviceCity matches, OR (legacy) who have at
    // least one order in a shop in that city.
    return cityFilter
      ? result.filter(
          (r) =>
            r.serviceCity?.toLowerCase() === cityFilter ||
            r.cities.some((c) => c.toLowerCase() === cityFilter),
        )
      : result;
  }

  /**
   * All platform customers with contact + coin balance + order stats, for the
   * admin customers console. Newest-registered first. Optional `q` filters by
   * name or phone (case-insensitive contains).
   */
  async listCustomers(opts?: { q?: string }) {
    const q = opts?.q?.trim();
    const customers = await this.prisma.user.findMany({
      where: {
        appType: 'CUSTOMER',
        deletedAt: null,
        // Exclude synthetic POS "Walk-in Customer" accounts (phone `pos:<shopId>`),
        // created per-shop for in-store cash sales — not real platform customers.
        NOT: { phone: { startsWith: 'pos:' } },
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      // Cap to the 100 newest — there's no pagination UI yet.
      take: 100,
      select: {
        id: true,
        name: true,
        phone: true,
        shortId: true,
        coinBalance: true,
        createdAt: true,
        loginPinEnc: true,
        loginOtpEnc: true,
      },
    });

    // Batch order stats for all customers in two groupBy queries (mirror
    // listRiders' totalMap/todayMap approach) rather than N per-customer counts.
    const customerIds = customers.map((c) => c.id);
    const [totalCounts, deliveredCounts] = await Promise.all([
      customerIds.length
        ? this.prisma.order.groupBy({
            by: ['customerId'],
            where: { customerId: { in: customerIds }, deletedAt: null },
            _count: { _all: true },
          })
        : [],
      customerIds.length
        ? this.prisma.order.groupBy({
            by: ['customerId'],
            where: { customerId: { in: customerIds }, status: 'DELIVERED', deletedAt: null },
            _count: { _all: true },
          })
        : [],
    ]);

    const totalMap: Record<string, number> = {};
    for (const r of totalCounts) if (r.customerId) totalMap[r.customerId] = r._count._all;
    const deliveredMap: Record<string, number> = {};
    for (const r of deliveredCounts) if (r.customerId) deliveredMap[r.customerId] = r._count._all;

    return customers.map((c) => ({
      userId: c.id,
      name: c.name ?? null,
      phone: c.phone ?? null,
      shortId: c.shortId ?? null,
      coinBalance: c.coinBalance,
      joinedAt: c.createdAt,
      loginPin: decryptOtp(c.loginPinEnc) ?? null,
      loginOtp: decryptOtp(c.loginOtpEnc) ?? null,
      totalOrders: totalMap[c.id] ?? 0,
      deliveredOrders: deliveredMap[c.id] ?? 0,
    }));
  }

  /**
   * Full detail for ONE rider — profile + KYC (identity + document URLs) + a
   * bounded slice of recent orders. Admin-only: exposes the private KYC record so
   * support can verify a partner or investigate an incident. 404 if no such rider.
   */
  async riderDetail(userId: string) {
    const profile = await this.prisma.riderProfile.findUnique({
      where: { userId },
      select: {
        userId: true,
        vehicle: true,
        serviceCity: true,
        online: true,
        earningsPaise: true,
        duesPaise: true,
        creditLimitPaise: true,
        createdAt: true,
        user: { select: { name: true, phone: true, shortId: true, createdAt: true } },
      },
    });
    if (!profile) throw new NotFoundException('Rider not found');

    const kyc = await this.prisma.riderKyc.findUnique({
      where: { userId },
      select: {
        fullName: true,
        aadhaar: true,
        pan: true,
        dlNumber: true,
        vehicleNumber: true,
        emergencyName: true,
        emergencyPhone: true,
        photoUrl: true,
        docUrls: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const recentOrders = await this.prisma.order.findMany({
      where: { riderId: userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        createdAt: true,
        originalTotalPaise: true,
        adjustedTotalPaise: true,
        paymentMethod: true,
        shop: { select: { name: true, city: true } },
      },
    });

    return {
      userId: profile.userId,
      name: profile.user?.name ?? null,
      phone: profile.user?.phone ?? null,
      shortId: profile.user?.shortId ?? null,
      serviceCity: profile.serviceCity ?? null,
      vehicle: profile.vehicle ?? null,
      online: profile.online,
      earningsPaise: profile.earningsPaise,
      duesPaise: profile.duesPaise,
      creditLimitPaise: profile.creditLimitPaise,
      joinedAt: profile.user?.createdAt ?? profile.createdAt,
      kyc: kyc
        ? {
            fullName: kyc.fullName,
            aadhaar: kyc.aadhaar,
            pan: kyc.pan,
            dlNumber: kyc.dlNumber,
            vehicleNumber: kyc.vehicleNumber,
            emergencyName: kyc.emergencyName,
            emergencyPhone: kyc.emergencyPhone,
            photoUrl: kyc.photoUrl,
            docUrls: Array.isArray(kyc.docUrls) ? (kyc.docUrls as string[]) : [],
            submittedAt: kyc.createdAt,
            updatedAt: kyc.updatedAt,
          }
        : null,
      recentOrders: recentOrders.map((o) => ({
        orderId: o.id,
        orderRef: o.id.slice(0, 8).toUpperCase(),
        status: o.status,
        createdAt: o.createdAt,
        shopName: o.shop?.name ?? null,
        city: o.shop?.city ?? null,
        totalPaise: o.adjustedTotalPaise ?? o.originalTotalPaise,
        paymentMethod: o.paymentMethod,
      })),
    };
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
      select: { id: true, verificationStatus: true, city: true },
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
  async listAllOrders(page: PaginationQuery = {}, status?: string, shopId?: string, q?: string, adminId?: string, role?: string) {
    const where: Record<string, unknown> = { deletedAt: null };
    // City-first: a city admin only sees orders from shops in their own city.
    const city = adminId ? await resolveAdminCity(this.prisma, adminId, role ?? '') : null;
    if (city) where.shop = { is: { city: { equals: city, mode: 'insensitive' } } };
    if (status) {
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
    }
    if (shopId) where.shopId = shopId;
    const term = q?.trim();
    if (term) {
      // Server-side search across order id/shortId, customer & shop name/phone
      // so the admin can find ANY order, not just the pages already loaded.
      where.OR = [
        { shortId: { contains: term, mode: 'insensitive' } },
        { id: { contains: term, mode: 'insensitive' } },
        { customer: { is: { name: { contains: term, mode: 'insensitive' } } } },
        { customer: { is: { phone: { contains: term, mode: 'insensitive' } } } },
        { shop: { is: { name: { contains: term, mode: 'insensitive' } } } },
      ];
    }
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
        extraDeliveryDuePaise: true,
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
        additionalRiderIds: true,
        shop: { select: { id: true, shortId: true, name: true, city: true } },
        customer: { select: { id: true, shortId: true, name: true, phone: true } },
        rider: { select: { id: true, shortId: true, name: true, phone: true } },
        items: { select: { id: true, nameSnapshot: true, qty: true, pricePaiseSnapshot: true, status: true } },
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
        extraDeliveryDuePaise: o.extraDeliveryDuePaise,
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
        additionalRiderIds: o.additionalRiderIds,
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
   * Admin: update the delivery fee on a live order.
   *
   * If the order is prepaid (UPI_DIRECT + paymentConfirmed), we cannot ask the
   * customer to pay again via UPI, so the delta above the original fee is stored
   * in extraDeliveryDuePaise — the rider collects it as cash/UPI at the door.
   *
   * Allowed on any non-terminal status so dispatch delays don't block the edit.
   */
  async updateOrderDeliveryFee(adminId: string, orderId: string, newFeePaise: number) {
    if (!Number.isInteger(newFeePaise) || newFeePaise < 0) {
      throw new BadRequestException('newFeePaise must be a non-negative integer');
    }

    const TERMINAL = ['DELIVERED', 'CANCELLED', 'REJECTED', 'REFUNDED'];
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        id: true,
        status: true,
        paymentMethod: true,
        paymentConfirmed: true,
        deliveryFeePaise: true,
        extraDeliveryDuePaise: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (TERMINAL.includes(order.status)) {
      throw new BadRequestException(`Cannot edit delivery fee on a terminal order (${order.status})`);
    }

    const isPrepaid = order.paymentMethod === 'UPI_DIRECT' && order.paymentConfirmed;
    const delta = newFeePaise - order.deliveryFeePaise;

    // For prepaid orders the original fee is already settled; any increase becomes
    // a due amount the rider collects at delivery. Decreases reduce the due first.
    const newDue = isPrepaid
      ? Math.max(0, order.extraDeliveryDuePaise + delta)
      : 0;

    await this.prisma.order.update({
      where: { id: orderId },
      data: { deliveryFeePaise: newFeePaise, extraDeliveryDuePaise: newDue },
    });

    this.logger.log(
      `AUDIT admin.updateDeliveryFee admin=${adminId} orderId=${orderId} ` +
      `fee=${order.deliveryFeePaise}->${newFeePaise} due=${order.extraDeliveryDuePaise}->${newDue} prepaid=${isPrepaid}`,
    );
    return { deliveryFeePaise: newFeePaise, extraDeliveryDuePaise: newDue, isPrepaid };
  }

  /**
   * Admin: assign additional rider(s) to a bulk/heavy order.
   * The primary riderId is unchanged; this appends to additionalRiderIds.
   * Idempotent — re-adding an already-assigned rider is a no-op.
   */
  async assignAdditionalRiders(adminId: string, orderId: string, riderUserIds: string[]) {
    const TERMINAL = ['DELIVERED', 'CANCELLED', 'REJECTED', 'REFUNDED'];
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { id: true, status: true, additionalRiderIds: true, totalWeightGrams: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (TERMINAL.includes(order.status)) {
      throw new BadRequestException(`Cannot assign riders to a terminal order (${order.status})`);
    }
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

  /** Admin: full detail for one bulk order — sub-orders, items, shop, customer, rider, address. */
  async getBulkOrder(id: string) {
    const bulk = await this.prisma.bulkOrder.findUnique({
      where: { id, deletedAt: null },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        rider: { select: { name: true, phone: true } },
        address: { select: { line: true, landmark: true, latitude: true, longitude: true } },
        orders: {
          select: {
            id: true, shortId: true, shopId: true, status: true,
            originalTotalPaise: true, platformFeePaise: true, discountPaise: true, coinsRedeemedPaise: true, deliveryFeePaise: true,
            paymentMethod: true, paymentConfirmed: true, riderPickupOtp: true,
            items: { select: { nameSnapshot: true, pricePaiseSnapshot: true, qty: true } },
            shop: { select: { id: true, name: true, upiVpa: true, contactPhone: true } },
          },
        },
      },
    });
    if (!bulk) throw new NotFoundException('Bulk order not found');
    return bulk;
  }

  /** Admin: list bulk orders newest-first, keyset paginated. City-scoped. */
  async listBulkOrders(limit = 20, cursor?: string, adminId?: string, role?: string) {
    // City-first: a city admin only sees bulk orders touching a shop in their city.
    const city = adminId ? await resolveAdminCity(this.prisma, adminId, role ?? '') : null;
    const rows = await this.prisma.bulkOrder.findMany({
      where: {
        ...(city ? { orders: { some: { shop: { is: { city: { equals: city, mode: 'insensitive' } } } } } } : {}),
        deletedAt: null,
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        shortId: true,
        status: true,
        paymentMethod: true,
        totalPaise: true,
        baseDeliveryFeePaise: true,
        multiShopSurchargePaise: true,
        createdAt: true,
        rider: { select: { name: true, phone: true } },
        orders: {
          select: {
            id: true,
            shortId: true,
            shopId: true,
            status: true,
            shop: { select: { name: true } },
          },
        },
      },
    });
    const hasMore = rows.length > limit;
    return { items: rows.slice(0, limit), nextCursor: hasMore ? rows[limit - 1].id : null };
  }

  /**
   * Admin: mark order as partially delivered. Updates adjustedTotalPaise based on
   * which items were actually fulfilled, sets status to DELIVERED, and opens a
   * system dispute so the customer can claim a partial refund.
   */
  async markPartialDelivery(adminId: string, orderId: string, fulfilledItemIds: string[]) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'OUT_FOR_DELIVERY' && order.status !== 'DELIVERED') {
      throw new BadRequestException('Partial delivery can only be set on OUT_FOR_DELIVERY or DELIVERED orders');
    }
    // Mark non-fulfilled items as UNAVAILABLE
    const nonFulfilled = order.items.filter(i => !fulfilledItemIds.includes(i.id)).map(i => i.id);
    if (nonFulfilled.length > 0) {
      await this.prisma.orderItem.updateMany({
        where: { id: { in: nonFulfilled } },
        data: { status: 'UNAVAILABLE' },
      });
    }
    // Recompute adjusted total from fulfilled items
    const fulfilled = order.items.filter(i => fulfilledItemIds.includes(i.id));
    const subtotal = fulfilled.reduce((s, i) => s + i.pricePaiseSnapshot * i.qty, 0);
    const adjustedTotalPaise = subtotal + order.deliveryFeePaise + order.platformFeePaise;
    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'DELIVERED', adjustedTotalPaise },
    });
    // Open a system dispute for partial refund claim
    const ref = order.shortId ?? orderId.slice(0, 8).toUpperCase();
    const removedCount = nonFulfilled.length;
    const disputeMsg = `Admin marked order #${ref} as partially delivered — ${removedCount} item(s) not received. Customer should receive a partial refund.`;
    await this.disputes.openSystemDispute(orderId, disputeMsg);
    this.logger.log(`AUDIT admin.partialDelivery admin=${adminId} orderId=${orderId} fulfilled=${fulfilledItemIds.length}/${order.items.length}`);
    return { delivered: true, adjustedTotalPaise, removedCount };
  }
}
