import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CancelledBy, DeliveryMode, OrderStatus } from '@passwaala/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { DisputesService } from '../disputes/disputes.service';

/**
 * AutomationService — all system-driven background jobs. Every action is written
 * to AutomationLog so the admin taskboard can show a full "Done by System" trail.
 *
 * Jobs:
 *  1. remindShopsOfNewOrders    — re-emit order.created every 5 min for PLACED orders
 *  2. cancelStaleOrders         — auto-cancel PLACED orders idle ≥15 min
 *  3. autoOpenCloseShops        — toggle isOpen based on workingHours every minute
 *  4. redispatchExpiredOffers   — re-offer RIDER_ASSIGNED orders whose offer window expired
 *  5. closeShopsAtCreditLimit   — safety net: ensure over-limit shops are closed
 */
@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly disputes: DisputesService,
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
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.PLACED, createdAt: { lt: cutoff }, deletedAt: null },
      select: { id: true, shopId: true },
    });
    for (const order of orders) {
      this.realtime.emitOrderCreated(order.shopId, { orderId: order.id });
      await this.log({
        action: 'ORDER_REMIND',
        detail: `Re-notified shop of pending order`,
        orderId: order.id,
        shopId: order.shopId,
      });
    }
    if (orders.length > 0) {
      this.logger.log(`AUTOMATION reminded ${orders.length} shop(s) of pending orders`);
    }
  }

  // ---------------------------------------------------------------------------
  // Job 2 — Auto-cancel PLACED orders idle ≥15 min, restore stock + refund coins
  // ---------------------------------------------------------------------------
  @Cron('*/2 * * * *')
  async cancelStaleOrders() {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.PLACED, createdAt: { lt: cutoff }, deletedAt: null },
      select: {
        id: true,
        shortId: true,
        customerId: true,
        shopId: true,
        coinsRedeemedPaise: true,
        items: { select: { productId: true, qty: true } },
        shop: { select: { shortId: true, name: true } },
      },
    });

    for (const order of orders) {
      try {
        await this.prisma.$transaction([
          this.prisma.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.CANCELLED,
              cancelledBy: CancelledBy.SYSTEM,
              cancellationReason: 'No response from shop within 15 minutes',
              cancelledAt: new Date(),
            },
          }),
          ...order.items.map((item) =>
            this.prisma.product.update({
              where: { id: item.productId },
              data: { stock: { increment: item.qty } },
            }),
          ),
          ...(order.coinsRedeemedPaise > 0
            ? [
                this.prisma.user.update({
                  where: { id: order.customerId },
                  data: { coinBalance: { increment: order.coinsRedeemedPaise } },
                }),
              ]
            : []),
        ]);

        this.realtime.emitOrderStatusChanged(order.customerId, {
          orderId: order.id,
          status: OrderStatus.CANCELLED,
        });

        await this.disputes.openSystemDispute(order.id, 'No response from shop within 15 minutes — auto-cancelled by system.');

        const orderRef = (order as { shortId?: string | null }).shortId ?? `OR${order.id.replace(/-/g,'').slice(0,8).toUpperCase()}`;
        const shopRef = (order as { shop?: { shortId?: string | null; name?: string } }).shop?.shortId
          ? `${(order as { shop: { shortId: string; name: string } }).shop.shortId} (${(order as { shop: { name: string } }).shop.name})`
          : order.shopId.slice(0, 8).toUpperCase();

        await this.log({
          action: 'ORDER_AUTO_CANCELLED',
          detail: `Auto-cancelled after 15 min — no shop response. Order ${orderRef} · Shop ${shopRef}.${order.coinsRedeemedPaise > 0 ? ` Refunded ${order.coinsRedeemedPaise / 100} coins.` : ''}`,
          orderId: order.id,
          shopId: order.shopId,
        });

        this.logger.log(`AUTOMATION auto-cancelled order=${orderRef}`);
      } catch (err) {
        this.logger.error(`AUTOMATION cancel failed for order=${order.id}: ${(err as Error).message}`);
      }
    }
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

    // ---- Rule A: stale RIDER_ASSIGNED ≥20 min → release only ----
    const staleAssigned = await this.prisma.order.findMany({
      where: {
        status: 'RIDER_ASSIGNED' as never,
        deletedAt: null,
        updatedAt: { lt: new Date(now.getTime() - 20 * 60 * 1000) },
        riderId: { not: null },
      },
      select: { id: true, shortId: true, riderId: true, shopId: true, riderPickupOtp: true },
    });

    for (const order of staleAssigned) {
      try {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'READY' as never, riderId: null },
        });
        await this.log({
          action: 'RIDER_STALE_ASSIGNED_RELEASED',
          detail: `Order ${order.shortId ?? order.id.slice(0,8)} released back to job board — rider did not confirm pickup within 20 min.`,
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
}
