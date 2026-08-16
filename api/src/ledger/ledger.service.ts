import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  GstBreakdown,
  LedgerEntryType,
  PLATFORM_FEE_PAISE,
  computeGst,
} from '@nearbaz/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CitiesService } from '../cities/cities.service';
import { PaginationQuery, cursorArgs, toPage } from '../common/pagination';

/** A single computed ledger line, ready to persist (all money in paise). */
export interface LedgerLine {
  type: LedgerEntryType;
  basePaise: number;
  gstPaise: number;
  /** SIGNED total: base + gst; negative for credits/reversals. */
  totalPaise: number;
}

/**
 * LedgerService — commission/fee accrual, dues, and credit-limit reporting
 * (plan → Revenue Model & Commission Ledger, GST, Credit Limit).
 *
 * PHASE 0 SCOPE: persistence + credit-limit enforcement are stubs (need the
 * DB), but the money math is REAL and unit-tested — an accrual line applies
 * 18% GST via the shared computeGst helper, and credit entries are correctly
 * signed negative. Getting paise/GST right from day one is the point.
 *
 * HARD RULES when implemented:
 *  - All money is integer paise (schema rule #4); GST 18% stored as a separate
 *    component; dues + credit-limit checks use the GST-inclusive total.
 *  - Each DELIVERED order writes COMMISSION + PLATFORM_FEE lines.
 *  - Credits (REFERRAL_CREDIT, REFUND_REVERSAL) are signed negative so a
 *    cancelled/refunded order never bills the shop.
 *  - Ledger rows are never hard-deleted (losing one = losing money owed).
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cities: CitiesService,
  ) {}

  /**
   * Build a debit ledger line (shop owes NearBaz): applies 18% GST on the base
   * and returns a positive signed total. Pure/real — no DB.
   */
  buildDebitLine(type: LedgerEntryType, basePaise: number): LedgerLine {
    const gst: GstBreakdown = computeGst(basePaise);
    return {
      type,
      basePaise: gst.basePaise,
      gstPaise: gst.gstPaise,
      totalPaise: gst.totalPaise, // positive: owed to NearBaz
    };
  }

  /**
   * Build a credit ledger line (NearBaz credits the shop, e.g. a referral or a
   * refund reversal): signed NEGATIVE so it reduces outstanding dues. Pure/real.
   */
  buildCreditLine(type: LedgerEntryType, basePaise: number): LedgerLine {
    const gst: GstBreakdown = computeGst(basePaise);
    return {
      type,
      basePaise: -gst.basePaise,
      gstPaise: -gst.gstPaise,
      totalPaise: -gst.totalPaise, // negative: credit against dues
    };
  }

  /**
   * Accrue dues on a DELIVERED order: writes a COMMISSION line (unless the shop
   * is inside its commission holiday) + a PLATFORM_FEE line (₹10, always), each
   * with 18% GST, and increments the shop's outstandingDues. When dues cross the
   * credit limit the shop is auto-paused (SUSPENDED-style: isOpen=false).
   *
   * Idempotent per order: if COMMISSION/PLATFORM_FEE entries already exist for
   * the order, it does nothing (a re-delivered order can't double-bill).
   */
  async accrueOnDelivery(orderId: string): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        id: true,
        shopId: true,
        originalTotalPaise: true,
        adjustedTotalPaise: true,
        platformFeePaise: true,
        deliveryFeePaise: true,
        discountPaise: true,
        nearbazDiscountPaise: true,
        couponId: true,
        couponCode: true,
        customerId: true,
        coinsRedeemedPaise: true,
        commissionRateSnapshot: true,
        paymentMethod: true,
        deliveryMode: true,
        codUpiClaimedAt: true,
      },
    });
    if (!order) return;

    const already = await this.prisma.ledgerEntry.count({
      where: {
        orderId,
        type: { in: [LedgerEntryType.COMMISSION, LedgerEntryType.PLATFORM_FEE] },
      },
    });
    if (already > 0) return; // exactly-once accrual

    const shop = await this.prisma.shop.findUnique({
      where: { id: order.shopId },
      select: { commissionFreeUntil: true, creditLimitPaise: true, outstandingDuesPaise: true, city: true },
    });
    if (!shop) return;

    // collectedTotal = what the customer paid = (S − D − N − C) + F_d + F_p
    const collectedTotal = order.adjustedTotalPaise ?? order.originalTotalPaise;
    // netItems = S − D − N − C (item money net of ALL discounts + coins), where
    // D = shop-funded discount, N = NearBaz-funded (platform) coupon discount.
    const netItems = collectedTotal - order.platformFeePaise - order.deliveryFeePaise;
    // Commission base = pre-discount subtotal S. The shop is commissioned on the
    // FULL subtotal regardless of who funded the discount — add back D + N + C.
    const commissionBasePaise =
      netItems + order.discountPaise + order.nearbazDiscountPaise + order.coinsRedeemedPaise;

    const inHoliday =
      shop.commissionFreeUntil != null && shop.commissionFreeUntil.getTime() > Date.now();

    // Build the signed ledger lines. Commission + platform fee carry 18% GST;
    // the pass-through / custody lines (delivery fee, COD remittance) carry none.
    const lines: LedgerLine[] = [];
    if (!inHoliday) {
      const commissionBase = Math.round(commissionBasePaise * order.commissionRateSnapshot);
      if (commissionBase > 0) {
        lines.push(this.buildDebitLine(LedgerEntryType.COMMISSION, commissionBase));
      }
    }
    // ₹10 platform fee always accrues (even during the holiday), with GST.
    lines.push(this.buildDebitLine(LedgerEntryType.PLATFORM_FEE, PLATFORM_FEE_PAISE));

    // Informational discount line (no dues impact) so the shopkeeper sees it.
    if (order.discountPaise > 0) {
      lines.push({
        type: LedgerEntryType.DISCOUNT_GIVEN,
        basePaise: order.discountPaise,
        gstPaise: 0,
        totalPaise: 0,
      });
    }

    // Delivery-fee custody branch (decision #1: full fee to rider).
    const isPlatformRider = order.deliveryMode === 'PLATFORM_RIDER';
    const nearbazHoldsCash =
      order.paymentMethod === 'COD' && isPlatformRider && order.codUpiClaimedAt == null;
    if (order.deliveryFeePaise > 0 && isPlatformRider) {
      if (nearbazHoldsCash) {
        // (d1) Rider deposits the full cash to NearBaz; NearBaz owes the shop
        // everything except the delivery fee it keeps for the rider.
        const owedToShop = collectedTotal - order.deliveryFeePaise;
        lines.push({
          type: LedgerEntryType.COD_REMITTANCE,
          basePaise: -owedToShop,
          gstPaise: 0,
          totalPaise: -owedToShop,
        });
      } else {
        // (b, d2) Shop collected the fee (via UPI); it owes it to NearBaz to pass on.
        lines.push({
          type: LedgerEntryType.RIDER_DELIVERY_FEE,
          basePaise: order.deliveryFeePaise,
          gstPaise: 0,
          totalPaise: order.deliveryFeePaise,
        });
      }
    }

    let duesDelta = 0;
    const creates = lines.map((l) => {
      duesDelta += l.totalPaise;
      return this.prisma.ledgerEntry.create({
        data: {
          shopId: order.shopId,
          orderId,
          type: l.type,
          basePaise: l.basePaise,
          gstPaise: l.gstPaise,
          totalPaise: l.totalPaise,
        },
      });
    });

    // Platform-funded coupon subsidy: NearBaz's OWN cost (a marketing expense),
    // recorded in the platform ledger — NEVER on the shop's ledger and never in
    // the shop's dues (duesDelta above excludes it). This is the accounting entry
    // for "a discount given by NearBaz". amountPaise is stored POSITIVE (money
    // given away). Written in the same once-only accrual guarded above.
    let cityId: string | null = null;
    if (order.nearbazDiscountPaise > 0 && shop.city) {
      const city = await this.prisma.serviceableCity.findFirst({
        where: { name: { equals: shop.city, mode: 'insensitive' }, deletedAt: null },
        select: { id: true },
      });
      cityId = city?.id ?? null;
    }
    const platformSubsidy =
      order.nearbazDiscountPaise > 0
        ? this.prisma.platformLedgerEntry.create({
            data: {
              type: 'COUPON_SUBSIDY',
              orderId,
              couponId: order.couponId,
              couponCode: order.couponCode,
              cityId,
              userId: order.customerId,
              amountPaise: order.nearbazDiscountPaise,
              note: 'NearBaz-funded coupon discount',
            },
          })
        : null;

    await this.prisma.$transaction([
      ...creates,
      ...(platformSubsidy ? [platformSubsidy] : []),
      this.prisma.shop.update({
        where: { id: order.shopId },
        data: { outstandingDuesPaise: { increment: duesDelta } },
      }),
    ]);

    // Credit-limit enforcement: auto-pause once dues cross the limit (never on
    // a negative balance — that means NearBaz owes the shop).
    const newDues = shop.outstandingDuesPaise + duesDelta;
    if (newDues >= shop.creditLimitPaise) {
      await this.prisma.shop.update({
        where: { id: order.shopId },
        data: { isOpen: false },
      });
    }
  }

  /**
   * Accrue a shop's sponsored-ad CPC spend for a day (plan → Ads billing =
   * CPC, settled at day-end). `basePaise` is the sum of the day's billable
   * clicks for one campaign; this writes ONE AD_SPEND debit line (18% GST, like
   * commission) and increments the shop's outstandingDues in a tx, then
   * auto-pauses the shop if dues cross the credit limit.
   *
   * Money discipline mirrors accrueOnDelivery: integer paise only, GST split via
   * computeGst, positive signed total (shop owes NearBaz). Idempotency for the
   * "once per (campaign, day)" guarantee lives in AdsService (AdEvent.settledAt);
   * this helper is a pure accrual and must only be called with an already-deduped
   * base amount. A non-positive base is a no-op (never write a zero/blank line).
   *
   * Returns the created ledger entry id + new dues, or null when nothing accrued.
   */
  async accrueAdSpend(
    shopId: string,
    basePaise: number,
  ): Promise<{ ledgerEntryId: string; totalPaise: number; newDuesPaise: number } | null> {
    if (!Number.isFinite(basePaise) || basePaise <= 0) return null;

    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, deletedAt: null },
      select: { creditLimitPaise: true, outstandingDuesPaise: true },
    });
    if (!shop) return null;

    const line = this.buildDebitLine(LedgerEntryType.AD_SPEND, Math.round(basePaise));

    const [entry] = await this.prisma.$transaction([
      this.prisma.ledgerEntry.create({
        data: {
          shopId,
          orderId: null, // ad spend is not tied to an order
          type: line.type,
          basePaise: line.basePaise,
          gstPaise: line.gstPaise,
          totalPaise: line.totalPaise,
        },
      }),
      this.prisma.shop.update({
        where: { id: shopId },
        data: { outstandingDuesPaise: { increment: line.totalPaise } },
      }),
    ]);

    const newDues = shop.outstandingDuesPaise + line.totalPaise;
    // Credit-limit enforcement: auto-pause once dues cross the limit (same rule
    // as accrueOnDelivery — ad debt is real dues and can pause a shop).
    if (newDues >= shop.creditLimitPaise) {
      await this.prisma.shop.update({
        where: { id: shopId },
        data: { isOpen: false },
      });
    }

    return { ledgerEntryId: entry.id, totalPaise: line.totalPaise, newDuesPaise: newDues };
  }


  async listForShop(shopId: string | undefined, page: PaginationQuery = {}) {
    if (!shopId) {
      throw new BadRequestException('No shop scope');
    }
    const [rows, shop] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where: { shopId, deletedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(page.limit, page.cursor),
      }),
      this.prisma.shop.findUnique({
        where: { id: shopId },
        select: { outstandingDuesPaise: true, creditLimitPaise: true, isOpen: true, city: true },
      }),
    ]);
    // Resolve NearBaz's collection UPI for the shop's city (owner-configured).
    // Null when the city has no UPI set — the client then shows offline copy.
    const collectionUpi = shop?.city
      ? await this.cities.getCollectionUpiForCity(shop.city)
      : null;
    const { items, nextCursor } = toPage(rows, page.limit);
    return {
      outstandingDuesPaise: shop?.outstandingDuesPaise ?? 0,
      creditLimitPaise: shop?.creditLimitPaise ?? 0,
      isOpen: shop?.isOpen ?? false,
      collectionUpi,
      // Surface a short, human order ref (first 8 of the UUID, uppercased) so
      // the shopkeeper UI can group + label entries by order. Null for
      // onboarding/referral entries that have no order.
      entries: items.map((e) => ({
        ...e,
        orderNumber: e.orderId ? e.orderId.slice(0, 8).toUpperCase() : null,
      })),
      nextCursor,
    };
  }

  /**
   * Admin records a shop's payment: flips ACCRUED entries to PAID, zeroes the
   * dues, and auto-reactivates a credit-paused shop. (Simple full-settlement for
   * the MVP; partial settlement is post-MVP.)
   */
  async recordPayment(shopId: string) {
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, deletedAt: null },
      select: { id: true, outstandingDuesPaise: true },
    });
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }
    // Only settle when the shop actually owes money — never wipe a negative
    // balance (that means NearBaz owes the shop; use payShopPayable for that).
    if (shop.outstandingDuesPaise <= 0) {
      return { settled: true, newDuesPaise: shop.outstandingDuesPaise };
    }
    await this.prisma.$transaction([
      this.prisma.ledgerEntry.updateMany({
        where: { shopId, status: 'ACCRUED' },
        data: { status: 'PAID' },
      }),
      this.prisma.shop.update({
        where: { id: shopId },
        data: { outstandingDuesPaise: 0, isOpen: true },
      }),
    ]);
    return { settled: true, newDuesPaise: 0 };
  }

  /**
   * NearBaz pays a shop its negative balance (money NearBaz owes the shop,
   * e.g. COD_REMITTANCE from cash a rider deposited). Writes a positive
   * SHOP_PAYOUT line and moves dues back toward zero. Amount is capped at the
   * outstanding payable (|negative dues|).
   */
  async payShopPayable(shopId: string, amountPaise: number) {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      throw new BadRequestException('Payout amount must be a positive whole number of paise');
    }
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, deletedAt: null },
      select: { id: true, outstandingDuesPaise: true },
    });
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }
    const payable = -shop.outstandingDuesPaise; // positive when NearBaz owes the shop
    if (payable <= 0) {
      throw new BadRequestException('This shop has no outstanding payable');
    }
    if (amountPaise > payable) {
      throw new BadRequestException(`Payout exceeds the ₹${payable / 100} owed to this shop`);
    }
    const [, updated] = await this.prisma.$transaction([
      this.prisma.ledgerEntry.create({
        data: {
          shopId,
          type: LedgerEntryType.SHOP_PAYOUT,
          basePaise: amountPaise,
          gstPaise: 0,
          totalPaise: amountPaise, // positive: moves dues toward 0
          status: 'PAID',
        },
      }),
      this.prisma.shop.update({
        where: { id: shopId },
        data: { outstandingDuesPaise: { increment: amountPaise } },
        select: { outstandingDuesPaise: true },
      }),
    ]);
    return { paid: true, newDuesPaise: updated.outstandingDuesPaise };
  }

  /**
   * Shopkeeper P&L over a window (or all-time). Aggregates DELIVERED orders +
   * ledger so the shop sees gross sales, discounts they gave, NearBaz-funded
   * coins, delivery fees (pass-through), commission, platform fee, and their net
   * position with NearBaz (positive netPosition = NearBaz owes them).
   */
  async plnSummaryForShop(shopId: string | undefined, since?: Date) {
    if (!shopId) {
      throw new BadRequestException('No shop scope');
    }
    const orderWhere = {
      shopId,
      status: 'DELIVERED' as const,
      deletedAt: null,
      ...(since ? { updatedAt: { gte: since } } : {}),
    };
    const [orders, ledgerRows, shop] = await Promise.all([
      this.prisma.order.findMany({
        where: orderWhere,
        select: {
          originalTotalPaise: true,
          adjustedTotalPaise: true,
          platformFeePaise: true,
          deliveryFeePaise: true,
          discountPaise: true,
          coinsRedeemedPaise: true,
        },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { shopId, deletedAt: null, ...(since ? { createdAt: { gte: since } } : {}) },
        select: { type: true, totalPaise: true },
      }),
      this.prisma.shop.findUnique({
        where: { id: shopId },
        select: { outstandingDuesPaise: true },
      }),
    ]);

    let grossSalesPaise = 0;
    let discountsGivenPaise = 0;
    let coinsRedeemedPaise = 0;
    let deliveryFeesPaise = 0;
    for (const o of orders) {
      const collected = o.adjustedTotalPaise ?? o.originalTotalPaise;
      const netItems = collected - o.platformFeePaise - o.deliveryFeePaise;
      grossSalesPaise += netItems + o.discountPaise + o.coinsRedeemedPaise; // pre-discount S
      discountsGivenPaise += o.discountPaise;
      coinsRedeemedPaise += o.coinsRedeemedPaise;
      deliveryFeesPaise += o.deliveryFeePaise;
    }

    const sumByType = (t: LedgerEntryType) =>
      ledgerRows.filter((r) => r.type === t).reduce((s, r) => s + r.totalPaise, 0);

    return {
      orderCount: orders.length,
      grossSalesPaise,
      discountsGivenPaise,
      coinsRedeemedPaise, // NearBaz-funded — not the shop's cost
      netItemRevenuePaise: grossSalesPaise - discountsGivenPaise - coinsRedeemedPaise,
      deliveryFeesPaise, // pass-through to rider
      commissionPaise: sumByType(LedgerEntryType.COMMISSION),
      platformFeePaise: sumByType(LedgerEntryType.PLATFORM_FEE),
      codCollectedByNearBazPaise: -sumByType(LedgerEntryType.COD_REMITTANCE),
      // >0 means NearBaz owes the shop; <0 means the shop owes NearBaz.
      netPositionPaise: -(shop?.outstandingDuesPaise ?? 0),
    };
  }

  /**
   * Shopkeeper self-settles their NearBaz dues over UPI (no gateway — money
   * flows straight to NearBaz's VPA; this records the claim, like the customer
   * confirm-payment flow). Flips ACCRUED entries to PAID, writes a signed-NEGATIVE
   * PAYMENT ledger line, and subtracts the amount from outstanding dues.
   *
   * Overpayment is allowed: dues may go NEGATIVE (advance credit), which future
   * commission/platform-fee accruals draw down first. Reactivates a paused shop
   * whenever the resulting dues fall below the credit limit.
   */
  async settleByShopkeeper(shopId: string | undefined, amountPaise: number) {
    if (!shopId) {
      throw new BadRequestException('No shop scope');
    }
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      throw new BadRequestException('Payment amount must be a positive whole number of paise');
    }
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, deletedAt: null },
      select: { id: true },
    });
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }
    // Atomic read-modify-write: decrement dues (may go negative — advance credit,
    // NOT clamped) so a concurrent accrual/payment can't lose the update. The
    // update returns the true post-write balance we use for reactivation.
    const [, , updatedShop] = await this.prisma.$transaction([
      // Settle everything currently owed.
      this.prisma.ledgerEntry.updateMany({
        where: { shopId, status: 'ACCRUED' },
        data: { status: 'PAID' },
      }),
      // Record the payment as a signed-negative, already-PAID ledger line.
      this.prisma.ledgerEntry.create({
        data: {
          shopId,
          type: LedgerEntryType.PAYMENT,
          basePaise: -amountPaise,
          gstPaise: 0,
          totalPaise: -amountPaise,
          status: 'PAID',
        },
      }),
      this.prisma.shop.update({
        where: { id: shopId },
        data: { outstandingDuesPaise: { decrement: amountPaise } },
        select: { outstandingDuesPaise: true, creditLimitPaise: true, isOpen: true },
      }),
    ]);
    const newDues = updatedShop.outstandingDuesPaise;
    // Reactivate a paused shop when the true post-payment balance is under the
    // limit (re-derived from the atomic write, never a stale pre-read).
    if (!updatedShop.isOpen && newDues < updatedShop.creditLimitPaise) {
      await this.prisma.shop.update({
        where: { id: shopId },
        data: { isOpen: true },
      });
    }
    return { settled: true, newDuesPaise: newDues };
  }
}
