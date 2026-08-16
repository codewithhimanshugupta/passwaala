import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DeliveryMode, OrderStatus } from '@nearbaz/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { WebPushService } from '../notifications/web-push.service';

/**
 * AutomationService — all system-driven background jobs. Every action is written
 * to AutomationLog so the admin taskboard can show a full "Done by System" trail.
 *
 * Jobs:
 *  1. remindShopsOfNewOrders    — re-emit order.created every 5 min for PLACED orders
 *  2. autoOpenCloseShops        — toggle isOpen based on workingHours every minute
 *  3. redispatchExpiredOffers   — re-offer RIDER_ASSIGNED orders whose offer window expired
 *  4. closeShopsAtCreditLimit   — safety net: ensure over-limit shops are closed
 *
 * Note: auto-cancellation of stale orders (no shop response in 15 min) is now
 * handled by a per-order setTimeout fired at placement in OrdersService, so
 * no cron sweep is needed here.
 */
@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly webPush: WebPushService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helper: write one AutomationLog row
  // ---------------------------------------------------------------------------
  private async log(opts: {
    action: string;
    detail: string;
    orderId?: string;
    shopId?: string;
    riderUserId?: string;
  }) {
    try {
      await this.prisma.automationLog.create({ data: opts });
    } catch {
      // Never let logging failure break automation
    }
  }

  // ---------------------------------------------------------------------------
  // Job 1 — Re-notify shops every 5 min for unanswered PLACED orders
  // ---------------------------------------------------------------------------
  @Cron('*/5 * * * *')
  async remindShopsOfNewOrders() {
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.PLACED, deletedAt: null },
      select: { id: true, shopId: true, createdAt: true, shop: { select: { city: true } } },
    });
    for (const order of orders) {
      const cityCfg = order.shop?.city ? await this.prisma.serviceableCity.findFirst({
        where: { name: { equals: order.shop.city, mode: 'insensitive' }, deletedAt: null },
        select: { shopReminderMinutes: true },
      }) : null;
      const cutoffMs = (cityCfg?.shopReminderMinutes ?? 5) * 60 * 1000;
      if (Date.now() - order.createdAt.getTime() < cutoffMs) continue;
      this.realtime.emitOrderCreated(order.shopId, { orderId: order.id });
      await this.log({ action: 'ORDER_REMIND', detail: `Re-notified shop of pending order`, orderId: order.id, shopId: order.shopId });
    }
    if (orders.length > 0) this.logger.log(`AUTOMATION reminded ${orders.length} shop(s) of pending orders`);
  }

  // ---------------------------------------------------------------------------
  // Job 3 — Auto open/close shops based on workingHours (every minute)
  // ---------------------------------------------------------------------------
  @Cron('* * * * *')
  async autoOpenCloseShops() {
    const now = new Date();
    const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
    const hh = now.getHours().toString().padStart(2, '0');
    const mm = now.getMinutes().toString().padStart(2, '0');
    const currentTime = `${hh}:${mm}`;

    const shops = await this.prisma.shop.findMany({
      where: { deletedAt: null },
      select: { id: true, isOpen: true, workingHours: true, outstandingDuesPaise: true, creditLimitPaise: true },
    });

    for (const shop of shops) {
      try {
        const wh = shop.workingHours as Record<string, { open: string; close: string }> | null;
        if (!wh) continue;
        const day = wh[dayKey];
        if (!day?.open || !day?.close) continue;

        const shouldBeOpen = currentTime >= day.open && currentTime < day.close;
        // Don't auto-open if dues are at/over the credit limit
        const overLimit = shop.outstandingDuesPaise >= shop.creditLimitPaise;

        if (shouldBeOpen && !overLimit && !shop.isOpen) {
          await this.prisma.shop.update({ where: { id: shop.id }, data: { isOpen: true } });
          await this.log({ action: 'SHOP_AUTO_OPENED', detail: `Opened at ${currentTime} per working hours schedule`, shopId: shop.id });
        } else if (!shouldBeOpen && shop.isOpen) {
          await this.prisma.shop.update({ where: { id: shop.id }, data: { isOpen: false } });
          await this.log({ action: 'SHOP_AUTO_CLOSED', detail: `Closed at ${currentTime} per working hours schedule`, shopId: shop.id });
        }
      } catch (err) {
        this.logger.error(`AUTOMATION shop open/close failed shop=${shop.id}: ${(err as Error).message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Job 4 — Re-dispatch expired rider offers (every 30 sec via rapid cron)
  // ---------------------------------------------------------------------------
  @Cron('*/1 * * * *')
  async redispatchExpiredOffers() {
    const now = new Date();
    // Orders with an offer that expired and are still waiting for a rider
    const orders = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.RIDER_ASSIGNED,
        deliveryMode: DeliveryMode.PLATFORM_RIDER,
        offerExpiresAt: { lt: now },
        offeredRiderId: { not: null },
        dispatchExhausted: false,
        deletedAt: null,
      },
      select: { id: true, shopId: true, offeredRiderId: true },
    });

    for (const order of orders) {
      try {
        // Clear the expired offer so dispatch can re-offer to the next rider
        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            offeredRiderId: null,
            offerExpiresAt: null,
            dispatchTriedRiderIds: { push: order.offeredRiderId! },
          },
        });
        await this.log({
          action: 'DISPATCH_RE_OFFERED',
          detail: `Rider offer expired — cleared and re-queued for next nearest rider`,
          orderId: order.id,
          shopId: order.shopId,
          riderUserId: order.offeredRiderId ?? undefined,
        });
        this.logger.log(`AUTOMATION re-offered order=${order.id} (expired rider offer)`);
      } catch (err) {
        this.logger.error(`AUTOMATION re-dispatch failed for order=${order.id}: ${(err as Error).message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Job 5 — Safety net: auto-pause shops over credit limit (every 5 min)
  // ---------------------------------------------------------------------------
  @Cron('*/5 * * * *')
  async closeShopsAtCreditLimit() {
    const overLimit = await this.prisma.shop.findMany({
      where: {
        isOpen: true,
        deletedAt: null,
        outstandingDuesPaise: { gt: 0 },
      },
      select: { id: true, name: true, outstandingDuesPaise: true, creditLimitPaise: true },
    });

    for (const shop of overLimit) {
      if (shop.outstandingDuesPaise >= shop.creditLimitPaise) {
        try {
          await this.prisma.shop.update({ where: { id: shop.id }, data: { isOpen: false } });
          await this.log({
            action: 'SHOP_AUTO_PAUSED',
            detail: `Paused — dues ₹${shop.outstandingDuesPaise / 100} reached credit limit ₹${shop.creditLimitPaise / 100}`,
            shopId: shop.id,
          });
          this.logger.log(`AUTOMATION paused shop=${shop.id} (dues over limit)`);
        } catch (err) {
          this.logger.error(`AUTOMATION pause failed shop=${shop.id}: ${(err as Error).message}`);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Job 6 — Rider stale order handling (every 5 min)
  //
  // Rule A: RIDER_ASSIGNED ≥20 min → release back to READY (no penalty — just
  //   reassign so the order doesn't get stuck).
  //
  // Rule B: OUT_FOR_DELIVERY not delivered (order updatedAt old):
  //   ≥30 min → open a system dispute (admin alert)
  //   ≥45 min → add escalation message to the same dispute (or reopen if closed)
  //   ≥60 min → penalty (order total from rider earnings) + final dispute message
  // ---------------------------------------------------------------------------
  @Cron('*/5 * * * *')
  async handleStaleRiderOrders() {
    const now = new Date();

    // ---- Rule A: stale RIDER_ASSIGNED → release (threshold per city, default 20 min) ----
    const staleAssigned = await this.prisma.order.findMany({
      where: {
        status: 'RIDER_ASSIGNED' as never,
        deletedAt: null,
        riderId: { not: null },
      },
      select: { id: true, shortId: true, riderId: true, shopId: true, riderPickupOtp: true, updatedAt: true, shop: { select: { city: true } } },
    });

    for (const order of staleAssigned) {
      try {
        const cityCfg = order.shop?.city ? await this.prisma.serviceableCity.findFirst({
          where: { name: { equals: order.shop.city, mode: 'insensitive' }, deletedAt: null },
          select: { staleRiderMinutes: true },
        }) : null;
        const thresholdMs = (cityCfg?.staleRiderMinutes ?? 20) * 60 * 1000;
        if (now.getTime() - order.updatedAt.getTime() < thresholdMs) continue;
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'READY' as never, riderId: null },
        });
        await this.log({
          action: 'RIDER_STALE_ASSIGNED_RELEASED',
          detail: `Order ${order.shortId ?? order.id.slice(0,8)} released back to job board — rider did not confirm pickup within ${cityCfg?.staleRiderMinutes ?? 20} min.`,
          orderId: order.id,
          shopId: order.shopId,
          riderUserId: order.riderId ?? undefined,
        });
      } catch (err) {
        this.logger.error(`AUTOMATION stale-assigned release failed order=${order.id}: ${(err as Error).message}`);
      }
    }

    // ---- Rule B: stale OUT_FOR_DELIVERY escalation ----
    const staleDelivery = await this.prisma.order.findMany({
      where: {
        status: 'OUT_FOR_DELIVERY' as never,
        deletedAt: null,
        updatedAt: { lt: new Date(now.getTime() - 30 * 60 * 1000) },
        riderId: { not: null },
      },
      select: {
        id: true, shortId: true, riderId: true, shopId: true, customerId: true,
        originalTotalPaise: true, adjustedTotalPaise: true,
        updatedAt: true,
      },
    });

    for (const order of staleDelivery) {
      if (!order.riderId) continue;
      const staleMins = Math.floor((now.getTime() - order.updatedAt.getTime()) / 60000);
      const ref = order.shortId ?? order.id.slice(0, 8);

      try {
        // Find existing system dispute for this order
        const existingDispute = await this.prisma.orderDispute.findFirst({
          where: { orderId: order.id },
          select: { id: true, status: true },
        });

        // Penalty applies ONCE per order — guard on a prior RIDER_DELIVERY_PENALTY
        // automation log for this order (the dispute status was never a reliable
        // marker, so the penalty used to re-fire every sweep).
        const alreadyPenalized = await this.prisma.automationLog.findFirst({
          where: { orderId: order.id, action: 'RIDER_DELIVERY_PENALTY' },
          select: { id: true },
        });

        if (staleMins >= 60 && !alreadyPenalized) {
          // ≥60 min: penalty + dispute message
          const penalty = order.adjustedTotalPaise ?? order.originalTotalPaise;
          await this.prisma.riderProfile.update({
            where: { userId: order.riderId as string },
            data: { earningsPaise: { decrement: penalty } },
          });
          const msg = `⚠️ PENALTY APPLIED: Order ${ref} not delivered after 60+ min. ₹${penalty / 100} deducted from rider earnings. Immediate admin action required.`;
          if (existingDispute) {
            if (existingDispute.status === 'RESOLVED') {
              await this.prisma.orderDispute.update({ where: { id: existingDispute.id }, data: { status: 'OPEN', reopenCount: { increment: 1 } } });
            }
            await this.prisma.disputeMessage.create({ data: { disputeId: existingDispute.id, senderId: order.riderId as string, senderRole: 'SYSTEM', body: msg } });
          } else {
            const d = await this.prisma.orderDispute.create({ data: { orderId: order.id, raisedById: order.riderId as string, raisedByRole: 'SYSTEM', reason: msg, status: 'OPEN' } });
            await this.prisma.disputeMessage.create({ data: { disputeId: d.id, senderId: order.riderId as string, senderRole: 'SYSTEM', body: msg } });
          }
          await this.log({ action: 'RIDER_DELIVERY_PENALTY', detail: msg, orderId: order.id, shopId: order.shopId, riderUserId: order.riderId as string });
          this.realtime.emitSystemAlert(order.riderId as string, { message: msg });

        } else if (staleMins >= 45 && staleMins < 60) {
          // ≥45 min: escalate ONCE (guard on a prior escalation log for this order).
          const alreadyEscalated = await this.prisma.automationLog.findFirst({
            where: { orderId: order.id, action: 'RIDER_DELIVERY_ESCALATED' },
            select: { id: true },
          });
          if (!alreadyEscalated) {
            const msg = `🔴 ESCALATION: Order ${ref} still not delivered after 45 min. Rider unresponsive.`;
            if (existingDispute) {
              if (existingDispute.status === 'RESOLVED') {
                await this.prisma.orderDispute.update({ where: { id: existingDispute.id }, data: { status: 'OPEN', reopenCount: { increment: 1 } } });
              }
              await this.prisma.disputeMessage.create({ data: { disputeId: existingDispute.id, senderId: order.riderId as string, senderRole: 'SYSTEM', body: msg } });
            }
            await this.log({ action: 'RIDER_DELIVERY_ESCALATED', detail: msg, orderId: order.id, shopId: order.shopId, riderUserId: order.riderId as string });
            this.realtime.emitSystemAlert(order.riderId as string, { message: msg });
          }

        } else if (staleMins >= 30 && staleMins < 45 && !existingDispute) {
          // ≥30 min: open new dispute for admin
          const msg = `🟡 Order ${ref} has been OUT_FOR_DELIVERY for ${staleMins} min with no update. Rider may be stuck or unresponsive.`;
          const d = await this.prisma.orderDispute.create({ data: { orderId: order.id, raisedById: order.riderId as string, raisedByRole: 'SYSTEM', reason: msg, status: 'OPEN' } });
          await this.prisma.disputeMessage.create({ data: { disputeId: d.id, senderId: order.riderId as string, senderRole: 'SYSTEM', body: msg } });
          await this.log({ action: 'RIDER_DELIVERY_STALE', detail: msg, orderId: order.id, shopId: order.shopId, riderUserId: order.riderId as string });
        }
      } catch (err) {
        this.logger.error(`AUTOMATION stale-delivery escalation failed order=${order.id}: ${(err as Error).message}`);
      }
    }
  }

  // Job 7 — Credit-limit warning: push shop when dues reach 80% (every 10 min)
  @Cron('*/10 * * * *')
  async warnShopsApproachingCreditLimit() {
    const shops = await this.prisma.shop.findMany({
      where: { deletedAt: null, isOpen: true },
      select: { id: true, ownerId: true, outstandingDuesPaise: true, creditLimitPaise: true },
    });
    for (const shop of shops) {
      if (!shop.creditLimitPaise) continue;
      const pct = shop.outstandingDuesPaise / shop.creditLimitPaise;
      if (pct < 0.8 || pct >= 1.0) continue;
      const recent = await this.prisma.automationLog.findFirst({
        where: { shopId: shop.id, action: 'CREDIT_LIMIT_WARNING', createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      });
      if (recent) continue;
      await this.webPush.sendToUser(shop.ownerId, {
        title: 'Credit limit warning',
        body: `Your dues are at ${Math.round(pct * 100)}% of your credit limit. Clear dues to avoid auto-pause.`,
        tag: `credit-warning-${shop.id}`,
      }).catch(() => undefined);
      await this.log({ action: 'CREDIT_LIMIT_WARNING', detail: `Dues at ${Math.round(pct * 100)}% of limit`, shopId: shop.id });
    }
  }

  // Job 8 — Item-change auto-accept + customer nudge (every 2 min)
  @Cron('*/2 * * * *')
  async autoAcceptItemChanges() {
    const TERMINAL = [OrderStatus.CANCELLED, OrderStatus.REJECTED, OrderStatus.DELIVERED, OrderStatus.REFUND_PENDING, OrderStatus.REFUNDED];
    const orders = await this.prisma.order.findMany({
      where: { deletedAt: null, customerAcceptedChanges: false, itemsChangedAt: { not: null }, status: { notIn: TERMINAL as any } },
      select: { id: true, customerId: true, shopId: true, status: true, itemsChangedAt: true, shop: { select: { name: true, city: true } } },
    });
    for (const order of orders) {
      if (!order.itemsChangedAt) continue;
      const elapsedMs = Date.now() - order.itemsChangedAt.getTime();
      const cityCfg = order.shop?.city ? await this.prisma.serviceableCity.findFirst({
        where: { name: { equals: order.shop.city, mode: 'insensitive' }, deletedAt: null },
        select: { shopReminderMinutes: true },
      }) : null;
      const autoAcceptMs = (cityCfg?.shopReminderMinutes ?? 5) * 2 * 60 * 1000;
      if (elapsedMs >= autoAcceptMs) {
        await this.prisma.order.update({ where: { id: order.id }, data: { customerAcceptedChanges: true } });
        this.realtime.emitOrderStatusChanged(order.customerId, { orderId: order.id, status: order.status });
        await this.webPush.sendToUser(order.customerId, {
          title: 'Order changes auto-accepted',
          body: `Your order from ${order.shop?.name} was auto-accepted and is continuing.`,
          tag: `auto-accept-${order.id}`,
        }).catch(() => undefined);
        await this.log({ action: 'ORDER_CHANGES_AUTO_ACCEPTED', detail: `Auto-accepted after ${Math.round(elapsedMs / 60000)} min`, orderId: order.id, shopId: order.shopId });
      } else {
        await this.webPush.sendToUser(order.customerId, {
          title: 'Action needed — order updated',
          body: `${order.shop?.name} removed some items. Please review and accept to continue.`,
          tag: `item-change-nudge-${order.id}`,
        }).catch(() => undefined);
      }
    }
  }

  // Job 9 — AWAITING_PAYMENT reminder + reveal phone to shop after timeout (every 3 min)
  @Cron('*/3 * * * *')
  async remindCustomersAwaitingPayment() {
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.AWAITING_PAYMENT, paymentConfirmed: false, deletedAt: null },
      select: {
        id: true, shortId: true, customerId: true, shopId: true, updatedAt: true,
        shop: { select: { name: true, city: true, ownerId: true } },
        customer: { select: { phone: true } },
      },
    });
    for (const order of orders) {
      const elapsedMin = (Date.now() - order.updatedAt.getTime()) / 60000;
      const cityCfg = order.shop?.city ? await this.prisma.serviceableCity.findFirst({
        where: { name: { equals: order.shop.city, mode: 'insensitive' }, deletedAt: null },
        select: { shopReminderMinutes: true },
      }) : null;
      const callRevealMin = (cityCfg?.shopReminderMinutes ?? 5) * 2;
      await this.webPush.sendToUser(order.customerId, {
        title: 'Complete your payment',
        body: `Your order from ${order.shop?.name} is waiting for UPI payment.`,
        tag: `payment-reminder-${order.id}`,
      }).catch(() => undefined);
      if (elapsedMin >= callRevealMin && order.customer?.phone && order.shop?.ownerId) {
        const alreadyRevealed = await this.prisma.automationLog.findFirst({
          where: { orderId: order.id, action: 'CUSTOMER_PHONE_REVEALED_TO_SHOP' },
        });
        if (!alreadyRevealed) {
          const ref = order.shortId ?? order.id.slice(0, 8).toUpperCase();
          await this.webPush.sendToUser(order.shop.ownerId, {
            title: 'Customer hasn\'t paid',
            body: `Call ${order.customer.phone} to collect payment for order #${ref}.`,
            tag: `call-customer-${order.id}`,
          }).catch(() => undefined);
          await this.log({ action: 'CUSTOMER_PHONE_REVEALED_TO_SHOP', detail: `Revealed after ${Math.round(elapsedMin)} min`, orderId: order.id, shopId: order.shopId });
        }
      }
    }
  }

  // Job 10 — REFUND_PENDING SLA: escalate to admin dispute after 48h (every hour)
  @Cron('0 * * * *')
  async escalateStaleRefunds() {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.REFUND_PENDING, deletedAt: null, updatedAt: { lt: cutoff } },
      select: { id: true, shortId: true, customerId: true, shopId: true, adjustedTotalPaise: true, originalTotalPaise: true },
    });
    for (const order of orders) {
      const already = await this.prisma.automationLog.findFirst({ where: { orderId: order.id, action: 'REFUND_SLA_ESCALATED' } });
      if (already) continue;
      const ref = order.shortId ?? order.id.slice(0, 8).toUpperCase();
      const paise = order.adjustedTotalPaise ?? order.originalTotalPaise;
      const msg = `Refund SLA breach: Order #${ref} in REFUND_PENDING >48h. ₹${paise / 100} not refunded.`;
      const dispute = await this.prisma.orderDispute.create({
        data: { orderId: order.id, raisedById: order.customerId, raisedByRole: 'SYSTEM', reason: msg, status: 'OPEN' },
      });
      await this.prisma.disputeMessage.create({ data: { disputeId: dispute.id, senderId: order.customerId, senderRole: 'SYSTEM', body: msg } });
      await this.webPush.sendToUser(order.customerId, {
        title: 'Refund delayed — we\'re following up',
        body: `Refund for #${ref} is overdue. NearBaz has escalated this to our team.`,
        tag: `refund-sla-${order.id}`,
      }).catch(() => undefined);
      await this.log({ action: 'REFUND_SLA_ESCALATED', detail: msg, orderId: order.id, shopId: order.shopId });
    }
  }

  // ---------------------------------------------------------------------------
  // Job 11 — Recompute server-side shop rankScore (every 10 min)
  //
  // Zomato-style precomputed relevance so the discovery list is "already ranked,
  // instant, paginated". Distance, open/closed, time-of-day and ad-sponsorship
  // stay in the query-time ORDER BY (they depend on the requester's location /
  // now); this cron precomputes the location-independent blend into Shop.rankScore.
  //
  //   rankScore = 10·BayesianRating(0..5)          (quality)
  //             +  8·ln(1+orderCount)              (popularity, log-damped)
  //             + recency(lastOrderAt, ≤~30d)      (activity freshness)
  //             + newShopBoost(createdAt < 21d)    (temporary discovery boost)
  //             − ratingFloorPenalty(<3.5 w/ ≥5 reviews)   (suppress bad shops)
  //
  // One set-based UPDATE (no per-row round-trips) + one summary AutomationLog.
  // ---------------------------------------------------------------------------
  @Cron('*/10 * * * *')
  async recomputeShopRankScores() {
    try {
      const updated = await this.prisma.$executeRawUnsafe(`
        UPDATE "Shop" SET "rankScore" =
            (("ratingCount" * "avgRating" + 5 * 3.0) / ("ratingCount" + 5)) * 10
          + LN(1 + GREATEST("orderCount", 0)) * 8
          + CASE WHEN "lastOrderAt" IS NULL THEN 0
                 ELSE GREATEST(0, 10 - EXTRACT(EPOCH FROM (NOW() - "lastOrderAt")) / 86400.0 / 3.0)
            END
          + CASE WHEN "createdAt" > NOW() - INTERVAL '21 days' THEN 15 ELSE 0 END
          - CASE WHEN "ratingCount" >= 5 AND "avgRating" < 3.5 THEN 20 ELSE 0 END
        WHERE "deletedAt" IS NULL
      `);
      await this.log({
        action: 'RANK_SCORES_RECOMPUTED',
        detail: `Recomputed rankScore for ${updated} shop(s)`,
      });
    } catch (err) {
      this.logger.error(`AUTOMATION rankScore recompute failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Job 12 — Recompute per-customer taste profiles (every 6 hours)
  //
  // Personalization input: from each customer's DELIVERED orders, aggregate the
  // shop categories they buy from (→ normalized categoryWeightsJson) plus their
  // average order value + order count. At discovery, findNearby loads the
  // requester's profile and adds a small additive boost for shops in their
  // top categories / price band. Recompute is coarse (6h) — taste drifts slowly.
  // ---------------------------------------------------------------------------
  @Cron('0 */6 * * *')
  async recomputeCustomerProfiles() {
    try {
      // Per (customer, category) delivered-order counts.
      const catRows = await this.prisma.$queryRawUnsafe<
        Array<{ customerId: string; shopCategory: string; cnt: bigint }>
      >(`
        SELECT o."customerId", s."shopCategory", COUNT(*) AS cnt
          FROM "Order" o
          JOIN "Shop" s ON s.id = o."shopId"
         WHERE o.status = 'DELIVERED' AND o."deletedAt" IS NULL
         GROUP BY o."customerId", s."shopCategory"
      `);
      // Per-customer order count + average order value (paise).
      const aggRows = await this.prisma.$queryRawUnsafe<
        Array<{ customerId: string; orderCount: bigint; avgValue: number | null }>
      >(`
        SELECT o."customerId",
               COUNT(*) AS "orderCount",
               AVG(COALESCE(o."adjustedTotalPaise", o."originalTotalPaise")) AS "avgValue"
          FROM "Order" o
         WHERE o.status = 'DELIVERED' AND o."deletedAt" IS NULL
         GROUP BY o."customerId"
      `);

      // Build per-customer normalized category weights (0..1, sum≈1).
      const byCustomer = new Map<string, Record<string, number>>();
      const totals = new Map<string, number>();
      for (const r of catRows) {
        const n = Number(r.cnt);
        totals.set(r.customerId, (totals.get(r.customerId) ?? 0) + n);
      }
      for (const r of catRows) {
        const total = totals.get(r.customerId) || 1;
        const w = byCustomer.get(r.customerId) ?? {};
        w[r.shopCategory] = Number((Number(r.cnt) / total).toFixed(4));
        byCustomer.set(r.customerId, w);
      }

      let count = 0;
      for (const agg of aggRows) {
        const weights = byCustomer.get(agg.customerId) ?? {};
        await this.prisma.customerProfile.upsert({
          where: { userId: agg.customerId },
          create: {
            userId: agg.customerId,
            categoryWeightsJson: weights,
            avgOrderValuePaise: Math.round(Number(agg.avgValue ?? 0)),
            orderCount: Number(agg.orderCount),
          },
          update: {
            categoryWeightsJson: weights,
            avgOrderValuePaise: Math.round(Number(agg.avgValue ?? 0)),
            orderCount: Number(agg.orderCount),
          },
        });
        count++;
      }
      await this.log({
        action: 'CUSTOMER_PROFILES_RECOMPUTED',
        detail: `Recomputed taste profile for ${count} customer(s)`,
      });
    } catch (err) {
      this.logger.error(`AUTOMATION customerProfile recompute failed: ${(err as Error).message}`);
    }
  }
}
