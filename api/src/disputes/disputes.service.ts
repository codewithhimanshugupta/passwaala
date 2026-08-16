import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DISPUTE_WINDOW_HOURS } from '@nearbaz/shared';
import { PrismaService } from '../prisma/prisma.service';
import { resolveAdminCity } from '../common/admin-city';

// System auto-replies: if the user's message matches a keyword, the system
// sends a helpful context-aware reply instantly (before any admin joins).
const FAQ_REPLIES: Array<{ keywords: string[]; reply: string }> = [
  {
    keywords: ['cancel', 'cancelled', 'cancellation'],
    reply: '📋 Orders are auto-cancelled if the shop doesn\'t respond within 15 minutes. If your payment was made, it will be reversed automatically within 5-7 business days. If you need further help, an admin will assist you shortly.',
  },
  {
    keywords: ['refund', 'money back', 'return', 'reverse'],
    reply: '💰 Refunds for UPI payments are processed automatically within 5-7 business days back to your original payment method. For COD orders, no refund is needed as you paid on delivery. An admin will review your case shortly.',
  },
  {
    keywords: ['delivery', 'late', 'delay', 'not delivered', 'waiting'],
    reply: '🕐 If your order is taking longer than expected, please check the live tracking on the order screen. Delivery typically takes 20-45 minutes depending on distance. If it has been more than 1 hour, an admin will look into this for you.',
  },
  {
    keywords: ['wrong item', 'missing', 'incomplete', 'substitut'],
    reply: '📦 We\'re sorry about the incorrect or missing item. The shopkeeper may have substituted an out-of-stock item. An admin will review your order and help resolve this as quickly as possible.',
  },
  {
    keywords: ['payment', 'paid', 'upi', 'charged', 'deducted'],
    reply: '💳 If you\'ve made a payment but the order status hasn\'t updated, please wait a few minutes as bank confirmations can be delayed. If the issue persists, an admin will manually verify and update your order.',
  },
  {
    keywords: ['shop', 'contact', 'call', 'phone', 'number'],
    reply: '📞 You can call the shop directly using the phone button on the order tracking screen. The shop\'s contact number is shown there. If you can\'t reach them, an admin will follow up on your behalf.',
  },
];

const SYSTEM_ID = 'SYSTEM';

function findAutoReply(body: string): string | null {
  const lower = body.toLowerCase();
  for (const faq of FAQ_REPLIES) {
    if (faq.keywords.some(k => lower.includes(k))) return faq.reply;
  }
  return null;
}

@Injectable()
export class DisputesService {
  constructor(private readonly prisma: PrismaService) {}

  async raiseDispute(userId: string, role: string, orderId: string, reason: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        id: true, createdAt: true, status: true, paymentMethod: true,
        originalTotalPaise: true, adjustedTotalPaise: true,
        shop: { select: { name: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    const windowMs = DISPUTE_WINDOW_HOURS * 60 * 60 * 1000;
    if (Date.now() - order.createdAt.getTime() > windowMs) {
      throw new BadRequestException(`Disputes must be raised within ${DISPUTE_WINDOW_HOURS} hours of the order.`);
    }

    const existing = await this.prisma.orderDispute.findFirst({ where: { orderId, raisedByRole: role } });
    if (existing) throw new BadRequestException('You have already raised a dispute for this order.');

    const dispute = await this.prisma.orderDispute.create({
      data: { orderId, raisedById: userId, raisedByRole: role, reason },
      select: { id: true, orderId: true, status: true, reason: true, createdAt: true },
    });

    // Send an automatic welcome message from the system
    const total = (order.adjustedTotalPaise ?? order.originalTotalPaise) / 100;
    const welcome = `👋 Hi! We've received your dispute for order #${orderId.slice(0, 8).toUpperCase()} (${order.shop?.name ?? 'your order'}, ₹${total.toFixed(2)}).\n\nA NearBaz admin will review and respond shortly. In the meantime, you can type your question below — our system may be able to help instantly.`;
    await this.prisma.disputeMessage.create({
      data: { disputeId: dispute.id, senderId: SYSTEM_ID, senderRole: 'SYSTEM', body: welcome },
    });

    // Check if the reason itself triggers a FAQ auto-reply
    const faqReply = findAutoReply(reason);
    if (faqReply) {
      await this.prisma.disputeMessage.create({
        data: { disputeId: dispute.id, senderId: SYSTEM_ID, senderRole: 'SYSTEM', body: faqReply },
      });
    }

    return dispute;
  }

  /**
   * System-opened dispute for a cancelled / refund-pending order. Idempotent:
   * if a SYSTEM dispute already exists for the order it's a no-op (so retries or
   * a cancel→refund-pending transition don't create duplicates). Unlike
   * raiseDispute this has NO 48h window and needs no raiser — it lands in the
   * admin queue (OPEN) so every cancelled order gets reviewed. Best-effort: never
   * throws, so a dispute failure can't block the cancellation flow.
   *
   * `onlyIfRefundOwed` — set by the AUTOMATIC cancel/reject call sites (shop
   * rejects, 15-min auto-cancel, out-of-stock). A cancelled COD order that was
   * never paid owes no refund → opening a dispute is pure admin-queue noise, so
   * we skip it. Any prepaid (UPI_DIRECT) order, or a COD order already paid via
   * UPI (codUpiClaimedAt), still opens a dispute so the refund gets reviewed.
   * Deliberate admin actions (force-cancel, partial-delivery) omit this flag and
   * always open a dispute.
   */
  async openSystemDispute(
    orderId: string,
    reason: string,
    opts?: { onlyIfRefundOwed?: boolean },
  ): Promise<void> {
    try {
      const existing = await this.prisma.orderDispute.findFirst({
        where: { orderId, raisedByRole: 'SYSTEM' },
        select: { id: true },
      });
      if (existing) return; // already opened — idempotent no-op

      const order = await this.prisma.order.findFirst({
        where: { id: orderId, deletedAt: null },
        select: {
          id: true, originalTotalPaise: true, adjustedTotalPaise: true,
          paymentMethod: true, codUpiClaimedAt: true,
          shop: { select: { name: true } },
        },
      });
      if (!order) return;

      // Skip no-refund noise: COD order with no UPI payment claimed owes nothing.
      if (opts?.onlyIfRefundOwed) {
        const refundOwed = order.paymentMethod !== 'COD' || order.codUpiClaimedAt != null;
        if (!refundOwed) return;
      }

      const dispute = await this.prisma.orderDispute.create({
        data: { orderId, raisedById: SYSTEM_ID, raisedByRole: 'SYSTEM', reason },
        select: { id: true },
      });

      const total = (order.adjustedTotalPaise ?? order.originalTotalPaise) / 100;
      const intro = `⚠️ Auto-opened: order #${orderId.slice(0, 8).toUpperCase()} (${order.shop?.name ?? 'shop'}, ₹${total.toFixed(2)}) was cancelled.\n\nReason: ${reason}\n\nReview and resolve — contact the customer/shop if a refund or follow-up is needed.`;
      await this.prisma.disputeMessage.create({
        data: { disputeId: dispute.id, senderId: SYSTEM_ID, senderRole: 'SYSTEM', body: intro },
      });
    } catch {
      // Best-effort: never let dispute creation break the cancellation flow.
    }
  }

  async getMyDispute(userId: string, orderId: string) {
    const dispute = await this.prisma.orderDispute.findFirst({
      where: { orderId, raisedById: userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!dispute) return null;
    return dispute;
  }

  async getThread(disputeId: string, requesterId: string) {
    const dispute = await this.prisma.orderDispute.findFirst({
      where: { id: disputeId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');
    // Only the raiser or the assigned admin may read the thread
    if (dispute.raisedById !== requesterId && dispute.assignedAdminId !== requesterId) {
      throw new ForbiddenException('Access denied');
    }
    return dispute;
  }

  async sendMessage(senderId: string, senderRole: string, disputeId: string, body: string) {
    const dispute = await this.prisma.orderDispute.findFirst({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.status === 'RESOLVED') throw new BadRequestException('Dispute is already resolved');
    if (dispute.raisedById !== senderId && dispute.assignedAdminId !== senderId) {
      throw new ForbiddenException('Not a participant in this dispute');
    }

    const msg = await this.prisma.disputeMessage.create({
      data: { disputeId, senderId, senderRole, body },
    });

    // If the user (not admin) sent the message, check for a FAQ auto-reply
    if (senderRole !== 'ADMIN' && !dispute.assignedAdminId) {
      const faqReply = findAutoReply(body);
      if (faqReply) {
        await this.prisma.disputeMessage.create({
          data: { disputeId, senderId: SYSTEM_ID, senderRole: 'SYSTEM', body: faqReply },
        });
      }
    }

    return msg;
  }

  // ── Admin ──

  /**
   * The city an admin is scoped to, resolved via their ACTIVE AdminInvite.
   * Returns null for OWNER (or an admin with no city) — meaning "all cities".
   */
  private async adminCityName(adminId: string, role: string): Promise<string | null> {
    return resolveAdminCity(this.prisma, adminId, role);
  }

  /**
   * Restrict a dispute `where` to disputes whose order's shop is in `city`.
   * No-op when city is null (OWNER / unscoped admin sees every city).
   */
  private cityScopedWhere(where: Record<string, unknown>, city: string | null) {
    if (!city) return where;
    return { ...where, order: { shop: { is: { city } } } };
  }

  async listQueue(adminId: string, role: string, roleFilter?: string) {
    const city = await this.adminCityName(adminId, role);
    const base: Record<string, unknown> = { status: 'OPEN' };
    if (roleFilter) base.raisedByRole = roleFilter;
    const disputes = await this.prisma.orderDispute.findMany({
      where: this.cityScopedWhere(base, city),
      orderBy: { createdAt: 'asc' },
      include: { messages: { take: 1, orderBy: { createdAt: 'desc' } } },
    });
    return this.enrichDisputes(disputes);
  }

  async listAssigned(adminId: string) {
    const disputes = await this.prisma.orderDispute.findMany({
      where: { assignedAdminId: adminId, status: 'ASSIGNED' },
      orderBy: { assignedAt: 'asc' },
      include: { messages: { take: 1, orderBy: { createdAt: 'desc' } } },
    });
    return this.enrichDisputes(disputes);
  }

  async listResolved(adminId: string, role: string, roleFilter?: string) {
    const city = await this.adminCityName(adminId, role);
    const base: Record<string, unknown> = { status: 'RESOLVED' };
    if (roleFilter) base.raisedByRole = roleFilter;
    const disputes = await this.prisma.orderDispute.findMany({
      where: this.cityScopedWhere(base, city),
      orderBy: { resolvedAt: 'desc' },
      take: 50,
      include: { messages: { take: 1, orderBy: { createdAt: 'desc' } } },
    });
    return this.enrichDisputes(disputes);
  }

  async assignDispute(adminId: string, disputeId: string) {
    const existing = await this.prisma.orderDispute.findFirst({
      where: { assignedAdminId: adminId, status: 'ASSIGNED' },
    });
    if (existing) {
      throw new BadRequestException('You already have an active dispute assigned. Resolve it first.');
    }
    const dispute = await this.prisma.orderDispute.findFirst({ where: { id: disputeId, status: 'OPEN' } });
    if (!dispute) throw new NotFoundException('Dispute not found or already assigned');
    return this.prisma.orderDispute.update({
      where: { id: disputeId },
      data: { status: 'ASSIGNED', assignedAdminId: adminId, assignedAt: new Date() },
    });
  }

  async resolveDispute(adminId: string, disputeId: string) {
    const dispute = await this.prisma.orderDispute.findFirst({
      where: { id: disputeId, assignedAdminId: adminId },
    });
    if (!dispute) throw new NotFoundException('Dispute not found or not assigned to you');
    return this.prisma.orderDispute.update({
      where: { id: disputeId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
  }

  async reopenDispute(userId: string, disputeId: string) {
    const dispute = await this.prisma.orderDispute.findFirst({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.raisedById !== userId) throw new ForbiddenException('Not your dispute');
    if (dispute.status !== 'RESOLVED') throw new BadRequestException('Dispute is not resolved');
    if (dispute.reopenCount >= 1) throw new BadRequestException('Dispute can only be reopened once');
    // Clear assignment so it goes back to the open queue
    return this.prisma.orderDispute.update({
      where: { id: disputeId },
      data: {
        status: 'OPEN',
        resolvedAt: null,
        assignedAdminId: null,
        assignedAt: null,
        reopenCount: { increment: 1 },
      },
    });
  }

  async adminGetThread(disputeId: string, adminId: string) {
    const dispute = await this.prisma.orderDispute.findFirst({
      where: { id: disputeId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');
    // Block reading another admin's active dispute
    if (dispute.assignedAdminId && dispute.assignedAdminId !== adminId && dispute.status !== 'RESOLVED') {
      throw new ForbiddenException('This dispute is assigned to another admin');
    }
    // Enrich with order + raiser details
    const [order, raiser] = await Promise.all([
      this.prisma.order.findFirst({
        where: { id: dispute.orderId },
        select: {
          id: true,
          shortId: true,
          status: true,
          originalTotalPaise: true,
          adjustedTotalPaise: true,
          paymentMethod: true,
          cancelledBy: true,
          cancellationReason: true,
          cancelledAt: true,
          refundConfirmedAt: true,
          createdAt: true,
          shop: { select: { name: true, city: true } },
          customer: { select: { name: true, phone: true } },
        },
      }),
      this.prisma.user.findFirst({ where: { id: dispute.raisedById }, select: { name: true, phone: true } }),
    ]);
    return { ...dispute, order, raiser };
  }

  async adminSendMessage(adminId: string, disputeId: string, body: string) {
    const dispute = await this.prisma.orderDispute.findFirst({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.status === 'RESOLVED') throw new BadRequestException('Dispute is already resolved');
    if (dispute.assignedAdminId && dispute.assignedAdminId !== adminId) {
      throw new ForbiddenException('This dispute is assigned to another admin');
    }

    // Auto-assign to this admin when they first message an unassigned dispute
    if (!dispute.assignedAdminId) {
      // Check the 1-per-admin rule
      const existing = await this.prisma.orderDispute.findFirst({
        where: { assignedAdminId: adminId, status: 'ASSIGNED' },
      });
      if (existing && existing.id !== disputeId) {
        throw new BadRequestException('You already have an active dispute assigned. Resolve it first.');
      }
      await this.prisma.orderDispute.update({
        where: { id: disputeId },
        data: { status: 'ASSIGNED', assignedAdminId: adminId, assignedAt: new Date() },
      });
    }

    return this.prisma.disputeMessage.create({
      data: { disputeId, senderId: adminId, senderRole: 'ADMIN', body },
    });
  }

  async queueCounts(adminId: string, role: string) {
    const city = await this.adminCityName(adminId, role);
    const rows = await this.prisma.orderDispute.groupBy({
      by: ['raisedByRole'],
      where: this.cityScopedWhere({ status: 'OPEN' }, city),
      _count: { _all: true },
    });
    const out: Record<string, number> = { CUSTOMER: 0, SHOP: 0, RIDER: 0, SYSTEM: 0 };
    for (const r of rows) out[r.raisedByRole] = r._count._all;
    return out;
  }

  private async enrichDisputes(disputes: Array<Record<string, unknown>>) {
    if (!disputes.length) return [];
    const orderIds = disputes.map((d) => (d as { orderId: string }).orderId);
    const raiserIds = disputes.map((d) => (d as { raisedById: string }).raisedById);
    const [orders, raisers] = await Promise.all([
      this.prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          shortId: true,
          status: true,
          paymentMethod: true,
          originalTotalPaise: true,
          adjustedTotalPaise: true,
          cancelledBy: true,
          cancellationReason: true,
          cancelledAt: true,
          refundConfirmedAt: true,
          createdAt: true,
          shop: { select: { name: true, city: true } },
          customer: { select: { name: true, phone: true } },
        },
      }),
      this.prisma.user.findMany({
        where: { id: { in: raiserIds } },
        select: { id: true, name: true, phone: true },
      }),
    ]);
    const orderMap = Object.fromEntries(orders.map((o) => [o.id, o]));
    const raiserMap = Object.fromEntries(raisers.map((u) => [u.id, u]));
    return disputes.map((d) => ({
      ...d,
      order: orderMap[(d as { orderId: string }).orderId] ?? null,
      raiser: raiserMap[(d as { raisedById: string }).raisedById] ?? null,
    }));
  }
}
