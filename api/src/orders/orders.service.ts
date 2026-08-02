import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CancelledBy,
  DeliveryMode,
  OrderStatus,
  PaymentMethod,
  VerificationStatus,
  canTransition,
  computeBill,
  haversineMeters,
  isWithinDeliveryRange,
  platformDeliveryFeePaise,
} from '@passwaala/shared';
import { PrismaService } from '../prisma/prisma.service';
import { assertOwnedByShop, requireShopScope } from '../common/shop-scope';
import { PaginationQuery, cursorArgs, toPage } from '../common/pagination';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { LedgerService } from '../ledger/ledger.service';
import { ReferralsService } from '../referrals/referrals.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { DisputesService } from '../disputes/disputes.service';
import { AdvanceOrderDto } from './dto/advance-order.dto';
import { PlaceOrderDto } from './dto/place-order.dto';
import {
  CUSTOMER_DETAIL_SELECT,
  ORDER_MUTATION_SELECT,
  SHOP_FEED_SELECT,
} from './order-select';

/**
 * OrdersService — order placement (Phase 3) + the shopkeeper's incoming order
 * feed and lifecycle transitions (Phase 1, plan → Shopkeeper App, Order
 * Exceptions, accept-before-pay).
 *
 * HARD RULES enforced:
 *  - Transitions are validated against the shared state machine (canTransition)
 *    — the single source of truth shared with the apps.
 *  - The feed + every transition are scoped to the shopkeeper's OWN shop
 *    (requireShopScope + assertOwnedByShop → 404 for another shop's order).
 *  - REJECTED requires a reason (out of stock / closing / too busy).
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly ledger: LedgerService,
    private readonly referrals: ReferralsService,
    private readonly dispatch: DispatchService,
    private readonly disputes: DisputesService,
  ) {}

  /**
   * Place an order from the customer's cart. Durable-write-first: the whole
   * order (row + items + initial PLACED status) is a single atomic transaction
   * that commits before returning (plan → Order Reliability). The idempotencyKey
   * makes it exactly-once — a retry with the same key returns the existing order.
   *
   * Snapshots product name + unit price onto each OrderItem, and the shop's
   * commissionRate onto the Order (schema rule #6). Enforces the shop is
   * APPROVED + open, the address belongs to the customer, and min-order-value.
   */
  async place(customerId: string, dto: PlaceOrderDto) {
    // Idempotency: return the existing order for a repeated key.
    const prior = await this.prisma.order.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { items: true },
    });
    if (prior) {
      if (prior.customerId !== customerId) {
        throw new ForbiddenException('Idempotency key belongs to another user');
      }
      return this.toPlacedResult(prior);
    }

    // The CUSTOMER chooses Delivery vs Self-pickup. For a delivery order, the
    // SHOP's setting decides HOW (platform rider if opted in, else self-deliver).
    const wantsPickup = dto.deliveryMode === DeliveryMode.SELF_PICKUP;
    const isPickup = wantsPickup;

    // For delivery, the address must belong to the customer (object-level auth).
    // Pickup skips the address entirely.
    let addressId: string | null = null;
    let dropCoords: { latitude: unknown; longitude: unknown } | null = null;
    if (!isPickup) {
      if (!dto.addressId) {
        throw new BadRequestException('A delivery address is required');
      }
      const address = await this.prisma.address.findFirst({
        where: { id: dto.addressId, userId: customerId, deletedAt: null },
        select: { id: true, latitude: true, longitude: true },
      });
      if (!address) {
        throw new NotFoundException('Address not found');
      }
      addressId = address.id;
      dropCoords = { latitude: address.latitude, longitude: address.longitude };
    }

    // Load the cart with shop economics + product snapshots + active offer.
    const cart = await this.prisma.cart.findFirst({
      where: { customerId, deletedAt: null },
      include: {
        shop: {
          include: {
            activeOffer: { select: { id: true, title: true, type: true, value: true, minOrderPaise: true, active: true } },
          },
        },
        items: { include: { product: true } },
      },
    });
    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }
    if (cart.shop.verificationStatus !== VerificationStatus.APPROVED) {
      throw new BadRequestException('Shop is not available');
    }
    if (!cart.shop.isOpen) {
      throw new BadRequestException('Shop is currently closed');
    }

    // Serviceable-area guard: a delivery drop point must be within the shop's
    // delivery radius (great-circle). A farther point — typically a different
    // city — is out of range and rejected. Pickup skips this (customer comes to
    // the shop). Mirrors the client-side block so a crafted request can't bypass it.
    if (!isPickup && dropCoords) {
      const inRange = isWithinDeliveryRange(
        { latitude: cart.shop.latitude, longitude: cart.shop.longitude },
        dropCoords,
      );
      if (!inRange) {
        throw new BadRequestException(
          'This delivery address is outside the shop\'s delivery area. Please choose an address closer to the shop.',
        );
      }
    }

    // Now that the shop is loaded, resolve the delivery mode from its setting.
    const deliveryMode = wantsPickup
      ? DeliveryMode.SELF_PICKUP
      : cart.shop.platformDeliveryEnabled
        ? DeliveryMode.PLATFORM_RIDER
        : DeliveryMode.SELF_DELIVERY;

    // Validate availability + stock, and build snapshotted line items.
    const items = cart.items.map((it) => {
      if (!it.product.available || it.product.stock < it.qty) {
        throw new BadRequestException(`"${it.product.name}" is out of stock`);
      }
      return {
        productId: it.productId,
        nameSnapshot: it.product.name,
        pricePaiseSnapshot: it.product.pricePaise,
        weightGramsSnapshot: (it.product as { weightGrams?: number | null }).weightGrams ?? null,
        qty: it.qty,
      };
    });

    // Total order weight in grams (null if any product is missing weightGrams).
    const totalWeightGrams = items.every((i) => i.weightGramsSnapshot !== null)
      ? items.reduce((sum, i) => sum + (i.weightGramsSnapshot ?? 0) * i.qty, 0)
      : null;

    const subtotalPaise = items.reduce(
      (sum, i) => sum + i.pricePaiseSnapshot * i.qty,
      0,
    );
    if (subtotalPaise < cart.shop.minOrderValuePaise) {
      throw new BadRequestException('Order is below the shop minimum');
    }

    // Delivery fee by mode:
    //  - SELF_PICKUP  → ₹0 (collect from shop).
    //  - PLATFORM_RIDER → distance-tiered (shop→drop), free-above does NOT apply
    //    (the rider is paid regardless of order value).
    //  - SELF_DELIVERY → the shop's flat fee + its free-delivery-above waiver.
    let deliveryFeePaise: number;
    let freeDeliveryAbovePaise: number | null | undefined;
    if (deliveryMode === DeliveryMode.SELF_PICKUP) {
      deliveryFeePaise = 0;
      freeDeliveryAbovePaise = null;
    } else if (deliveryMode === DeliveryMode.PLATFORM_RIDER) {
      const distanceMeters = haversineMeters(
        { latitude: cart.shop.latitude, longitude: cart.shop.longitude },
        dropCoords ?? { latitude: null, longitude: null },
      );
      // Use city-configured tiers (same as cart preview) so cart and order agree.
      const cityForFee = cart.shop.city;
      const cityTierConfig = cityForFee
        ? await this.prisma.serviceableCity.findFirst({
            where: { deletedAt: null, name: { equals: cityForFee, mode: 'insensitive' } },
            select: { deliveryTiersJson: true },
          })
        : null;
      if (cityTierConfig?.deliveryTiersJson) {
        const tiers: Array<{ maxKm: number; feePaise: number }> = JSON.parse(cityTierConfig.deliveryTiersJson);
        const distKm = distanceMeters / 1000;
        const tier = tiers.find(t => distKm <= t.maxKm) ?? tiers[tiers.length - 1];
        deliveryFeePaise = tier.feePaise;
      } else {
        // Fallback to built-in tiers when city has no custom config.
        deliveryFeePaise = platformDeliveryFeePaise(distanceMeters);
      }
      freeDeliveryAbovePaise = null;
    } else {
      deliveryFeePaise = cart.shop.deliveryFeePaise;
      freeDeliveryAbovePaise = cart.shop.freeDeliveryAbovePaise;
    }

    // Resolve offer: customer must explicitly choose an offer (no auto-apply).
    // Resolve offer: customer-chosen offerId takes priority over shop.activeOffer.
    // Validate the chosen offer belongs to the shop's city and is active.
    let offer: { id: string; title: string; type: string; value: number; minOrderPaise: number } | null = null;
    if (dto.offerId) {
      const chosen = await this.prisma.offerTemplate.findFirst({
        where: { id: dto.offerId, active: true, deletedAt: null, city: { name: { equals: cart.shop.city, mode: 'insensitive' } } },
        select: { id: true, title: true, type: true, value: true, minOrderPaise: true },
      });
      offer = chosen ?? null;
    }
    const bill = computeBill({
      subtotalPaise,
      deliveryFeePaise,
      freeDeliveryAbovePaise,
      offerType: offer?.type as import('@passwaala/shared').OfferType | null ?? null,
      offerValue: offer?.value ?? null,
      offerMinOrderPaise: offer?.minOrderPaise ?? null,
    });

    // PassWaala Coins redemption (1 coin = ₹1 = 100 paise). Discounts the item
    // SUBTOTAL only; capped by the customer's balance AND the subtotal. Fees are
    // always paid in full. The discounted amount is deducted from the balance.
    let coinsRedeemedPaise = 0;
    if (dto.redeemCoins && dto.redeemCoins > 0) {
      const customer = await this.prisma.user.findUnique({
        where: { id: customerId },
        select: { coinBalance: true },
      });
      const requestedPaise = dto.redeemCoins * 100; // 1 coin = 100 paise
      const balancePaise = (customer?.coinBalance ?? 0) * 100;
      coinsRedeemedPaise = Math.max(0, Math.min(requestedPaise, balancePaise, subtotalPaise));
    }
    const coinsRedeemedPaise_adjusted = Math.min(
      coinsRedeemedPaise,
      Math.max(0, bill.subtotalPaise - bill.discountPaise),
    );
    const totalPaise = bill.totalPaise - coinsRedeemedPaise_adjusted;

    // Handoff OTP shown to the customer; the shop verifies it before DELIVERED.
    const pickupOtp = Math.floor(1000 + Math.random() * 9000).toString();
    // Rider pickup OTP shown in the SHOPKEEPER app; the platform rider enters it
    // to confirm collection (RIDER_ASSIGNED -> OUT_FOR_DELIVERY). Generated on
    // every order; only consumed for PLATFORM_RIDER deliveries.
    const riderPickupOtp = Math.floor(1000 + Math.random() * 9000).toString();

    // Single atomic transaction: create the order + items, then clear the cart.
    const shopId = cart.shopId;
    const cartId = cart.id;
    const orderId = randomUUID();
    const orderShortId = `OR${orderId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const created = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          id: orderId,
          shortId: orderShortId,
          customerId,
          shopId,
          status: OrderStatus.PLACED,
          paymentMethod: dto.paymentMethod,
          deliveryMode,
          addressId,
          pickupOtp,
          riderPickupOtp,
          originalTotalPaise: totalPaise,
          coinsRedeemedPaise: coinsRedeemedPaise_adjusted,
          discountPaise: bill.discountPaise,
          offerId: bill.offerApplied && offer ? offer.id : null,
          offerTitle: bill.offerApplied && offer ? offer.title : null,
          platformFeePaise: bill.platformFeePaise,
          deliveryFeePaise: bill.deliveryFeePaise,
          commissionRateSnapshot: cart.shop.commissionRate,
          idempotencyKey: dto.idempotencyKey,
          totalWeightGrams,
          items: { create: items },
        },
        include: { items: true },
      });
      // Deduct redeemed coins from the customer's balance (1 coin = 100 paise).
      if (coinsRedeemedPaise_adjusted > 0) {
        await tx.user.update({
          where: { id: customerId },
          data: { coinBalance: { decrement: Math.round(coinsRedeemedPaise_adjusted / 100) } },
        });
      }
      // Decrement stock for each ordered item (inventory integrity — the sale
      // reduces available stock immediately, in the same atomic transaction).
      for (const it of items) {
        await tx.product.update({
          where: { id: it.productId },
          data: { stock: { decrement: it.qty } },
        });
      }
      // Empty the cart now that the order is durably captured.
      await tx.cartItem.deleteMany({ where: { cartId } });
      await tx.cart.delete({ where: { id: cartId } });
      return order;
    });

    // Off the durable path: live new-order alert to the shop's room. (Phase 1
    // reliability plan moves this onto a BullMQ queue with retries; the order is
    // already safe in the DB regardless of whether this emit lands.)
    this.realtime.emitOrderCreated(shopId, { orderId: created.id });

    return this.toPlacedResult(created);
  }

  /**
   * Customer: their order history (newest first), each with a summary. Keyset
   * paginated — pass the previous page's nextCursor to fetch older orders.
   */
  async historyForCustomer(customerId: string, page: PaginationQuery = {}) {
    const rows = await this.prisma.order.findMany({
      where: { customerId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(page.limit, page.cursor),
      include: {
        items: true,
        shop: {
          select: {
            id: true,
            name: true,
            addressLine: true,
            city: true,
            storefrontPhotoUrl: true,
            isOpen: true,
          },
        },
        reviews: {
          select: { rating: true, comment: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    const { items, nextCursor } = toPage(rows, page.limit);
    return {
      items: items.map((o) => ({
        orderId: o.id,
        shortId: o.shortId,
        shop: o.shop,
        status: o.status,
        deliveryMode: o.deliveryMode,
        itemCount: o.items.reduce((n, it) => n + it.qty, 0),
        // Compact item lines for the history card (name + qty), order preserved.
        items: o.items.map((it) => ({ nameSnapshot: it.nameSnapshot, qty: it.qty })),
        totalPaise: o.adjustedTotalPaise ?? o.originalTotalPaise,
        paymentMethod: o.paymentMethod,
        createdAt: o.createdAt.toISOString(),
        review: o.reviews[0] ?? null,
      })),
      nextCursor,
    };
  }

  /**
   * Customer: full detail of ONE of their own orders (object-level auth —
   * another customer's order is 404).
   */
  async findOneForCustomer(customerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId, deletedAt: null },
      select: CUSTOMER_DETAIL_SELECT,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  /**
   * Customer: claim they've paid a UPI order ("I've paid"). PassWaala is NOT in
   * the money flow, so this is a CLAIM — it does NOT confirm payment or advance
   * the order. It stamps paymentClaimedAt (+ bumps the attempt count) and keeps
   * the order in AWAITING_PAYMENT; the SHOP verifies receipt (verifyPayment) to
   * move it to PREPARING. Notifies the shop so it can check its UPI and verify.
   */
  async confirmPayment(customerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId, deletedAt: null },
      select: { id: true, status: true, shopId: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.status !== OrderStatus.AWAITING_PAYMENT) {
      throw new BadRequestException('This order is not awaiting payment');
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { paymentClaimedAt: new Date(), paymentClaimCount: { increment: 1 } },
      select: { id: true, status: true, paymentClaimedAt: true, paymentClaimCount: true },
    });
    // Nudge the shop's feed to re-check (customer claims payment sent).
    this.realtime.emitOrderStatusChanged(order.shopId, {
      orderId,
      status: order.status as OrderStatus,
    });
    return updated;
  }

  /**
   * Shopkeeper: VERIFY a customer's payment claim (they checked their UPI and
   * the money arrived). Requires an open claim (paymentClaimedAt set). Moves
   * AWAITING_PAYMENT → PREPARING and flags paymentConfirmed. Scoped to the OWN shop.
   */
  async verifyPayment(shopId: string | undefined, orderId: string) {
    const id = requireShopScope(shopId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { id: true, shopId: true, status: true, customerId: true, paymentClaimedAt: true },
    });
    const owned = assertOwnedByShop(order, id);
    if (!owned.paymentClaimedAt) {
      throw new BadRequestException('The customer has not marked this order as paid yet');
    }
    this.assertTransition(owned.status as OrderStatus, OrderStatus.PREPARING);
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.PREPARING, paymentConfirmed: true },
      select: ORDER_MUTATION_SELECT,
    });
    this.realtime.emitOrderStatusChanged(owned.customerId, {
      orderId,
      status: OrderStatus.PREPARING,
    });
    return updated;
  }

  /**
   * Shopkeeper: REJECT a payment claim (money not received). Clears
   * paymentClaimedAt (keeps the attempt count) and stays AWAITING_PAYMENT so the
   * customer's app re-prompts them to pay. Scoped to the OWN shop.
   */
  async rejectPaymentClaim(shopId: string | undefined, orderId: string) {
    const id = requireShopScope(shopId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { id: true, shopId: true, status: true, customerId: true },
    });
    const owned = assertOwnedByShop(order, id);
    if (owned.status !== OrderStatus.AWAITING_PAYMENT) {
      throw new BadRequestException('This order is not awaiting payment');
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { paymentClaimedAt: null },
      select: { id: true, status: true, paymentClaimedAt: true, paymentClaimCount: true },
    });
    this.realtime.emitOrderStatusChanged(owned.customerId, {
      orderId,
      status: owned.status as OrderStatus,
    });
    return updated;
  }

  /**
   * Shopkeeper: CONFIRM receipt of a COD order the rider marked paid by UPI/QR at
   * the door (codUpiClaimedAt set). Sets paymentConfirmed WITHOUT changing status
   * (the order is OUT_FOR_DELIVERY) so the rider can then mark it DELIVERED.
   * Scoped to the OWN shop.
   */
  async confirmCodUpiReceived(shopId: string | undefined, orderId: string) {
    const id = requireShopScope(shopId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { id: true, shopId: true, status: true, paymentMethod: true, deliveryMode: true, codUpiClaimedAt: true },
    });
    const owned = assertOwnedByShop(order, id);
    if (
      owned.paymentMethod !== PaymentMethod.COD ||
      owned.deliveryMode !== DeliveryMode.PLATFORM_RIDER ||
      !owned.codUpiClaimedAt
    ) {
      throw new BadRequestException('No rider UPI payment to confirm for this order');
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { paymentConfirmed: true },
      select: ORDER_MUTATION_SELECT,
    });
    return updated;
  }

  /**
   * Shopkeeper: the rider's COD-UPI claim is NOT received. Clears codUpiClaimedAt
   * so the rider re-prompts the customer (or collects cash instead). No status
   * change. Scoped to the OWN shop.
   */
  async rejectCodUpi(shopId: string | undefined, orderId: string) {
    const id = requireShopScope(shopId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { id: true, shopId: true, status: true },
    });
    const owned = assertOwnedByShop(order, id);
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { codUpiClaimedAt: null, paymentConfirmed: false },
      select: ORDER_MUTATION_SELECT,
    });
    return updated;
  }

  /**
   * Customer: one-tap reorder — rebuild the cart from a past order's items that
   * are still available in the same shop. Returns which items were skipped.
   */
  async reorder(customerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId, deletedAt: null },
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Clear any existing cart (single-shop rule).
    const existing = await this.prisma.cart.findFirst({
      where: { customerId, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.cartItem.deleteMany({ where: { cartId: existing.id } });
      await this.prisma.cart.delete({ where: { id: existing.id } });
    }

    const cart = await this.prisma.cart.create({
      data: { customerId, shopId: order.shopId },
      select: { id: true },
    });

    const skipped: string[] = [];
    for (const item of order.items) {
      const product = await this.prisma.product.findFirst({
        where: { id: item.productId, deletedAt: null, available: true },
        select: { id: true, stock: true },
      });
      if (!product || product.stock < item.qty) {
        skipped.push(item.nameSnapshot);
        continue;
      }
      await this.prisma.cartItem.create({
        data: { cartId: cart.id, productId: item.productId, qty: item.qty },
      });
    }

    return { rebuilt: true, skipped };
  }

  /**
   * Shopkeeper: mark order items UNAVAILABLE (item substitution during
   * accept-before-pay). Recomputes the adjustedTotal from the remaining
   * fulfilled items + fees; the customer must then approve the reduced order.
   * Scoped to the shopkeeper's OWN shop.
   */
  async markUnavailable(
    shopId: string | undefined,
    orderId: string,
    orderItemIds: string[],
  ) {
    const id = requireShopScope(shopId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, shopId: id, deletedAt: null },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const owned = order;

    // Mark the given items unavailable (only those on this order).
    const onThisOrder = new Set(owned.items.map((i) => i.id));
    const toMark = orderItemIds.filter((iid) => onThisOrder.has(iid));
    if (toMark.length === 0) {
      throw new BadRequestException('No matching order items');
    }

    await this.prisma.orderItem.updateMany({
      where: { id: { in: toMark }, orderId },
      data: { status: 'UNAVAILABLE' },
    });

    // Recompute adjusted total from the still-FULFILLED items + fees.
    const remaining = owned.items.filter((i) => !toMark.includes(i.id));

    // If ALL items are now unavailable, cancel the order automatically — there is
    // nothing left to fulfil and a zero-item order should never reach the customer.
    if (remaining.length === 0) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledBy: 'SHOP' as any,
          cancellationReason: 'All items are out of stock',
          cancelledAt: new Date(),
          adjustedTotalPaise: null,
        },
      });
      this.realtime.emitOrderStatusChanged(owned.customerId, {
        orderId,
        status: OrderStatus.CANCELLED,
      });
      await this.disputes.openSystemDispute(orderId, 'All items are out of stock — order cancelled by shop.');
      return { cancelled: true, adjustedTotalPaise: 0 };
    }

    const subtotal = remaining.reduce(
      (sum, i) => sum + i.pricePaiseSnapshot * i.qty,
      0,
    );
    // Re-apply the original discount + coins to the surviving subtotal so the
    // adjusted total stays consistent with what accrueOnDelivery expects
    // (collectedTotal = (S − D − C) + fees). Both are capped so the net can't
    // go negative when items are removed.
    const discount = Math.min(owned.discountPaise, subtotal);
    const coins = Math.min(owned.coinsRedeemedPaise, subtotal - discount);
    const adjustedTotalPaise =
      subtotal - discount - coins + owned.deliveryFeePaise + owned.platformFeePaise;

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { adjustedTotalPaise },
    });
    this.realtime.emitOrderStatusChanged(owned.customerId, {
      orderId,
      status: owned.status as OrderStatus,
    });
    return { adjustedTotalPaise: updated.adjustedTotalPaise };
  }

  /**
   * Shopkeeper: move a paid-but-unfulfillable order to REFUND_PENDING (the rare
   * money-already-paid case). PassWaala records the dispute; the shop refunds the
   * customer directly (no money moves here). Scoped to the OWN shop.
   */
  async markRefundPending(shopId: string | undefined, orderId: string) {
    const id = requireShopScope(shopId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { id: true, shopId: true, status: true, customerId: true },
    });
    const owned = assertOwnedByShop(order, id);
    this.assertTransition(owned.status as OrderStatus, OrderStatus.REFUND_PENDING);

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.REFUND_PENDING },
      select: ORDER_MUTATION_SELECT,
    });
    this.realtime.emitOrderStatusChanged(owned.customerId, {
      orderId,
      status: OrderStatus.REFUND_PENDING,
    });
    await this.disputes.openSystemDispute(orderId, 'Paid order moved to refund-pending by shop — refund owed to customer.');
    return updated;
  }

  /**
   * Customer confirms they received their off-platform refund → REFUNDED.
   * Scoped to the customer's own order; only valid from REFUND_PENDING.
   */
  async confirmRefundReceived(customerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId, deletedAt: null },
      select: { id: true, status: true, shopId: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    this.assertTransition(order.status as OrderStatus, OrderStatus.REFUNDED);
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.REFUNDED, refundConfirmedAt: new Date() },
      select: ORDER_MUTATION_SELECT,
    });
    // Notify the shop's feed so the completed tab reflects the closed refund.
    this.realtime.emitOrderStatusChanged(order.shopId, {
      orderId,
      status: OrderStatus.REFUNDED,
    });
    return updated;
  }

  /** Shape a created/loaded order into the customer-facing placement result. */
  private toPlacedResult(order: {
    id: string;
    status: string;
    shopId: string;
    originalTotalPaise: number;
    platformFeePaise: number;
    deliveryFeePaise: number;
    paymentMethod: string;
    deliveryMode: string;
    createdAt: Date;
  }) {
    return {
      orderId: order.id,
      status: order.status,
      shopId: order.shopId,
      platformFeePaise: order.platformFeePaise,
      deliveryFeePaise: order.deliveryFeePaise,
      totalPaise: order.originalTotalPaise,
      paymentMethod: order.paymentMethod,
      deliveryMode: order.deliveryMode,
      createdAt: order.createdAt.toISOString(),
    };
  }

  /**
   * Validate a proposed status change against the shared state machine.
   * Pure/real: throws BadRequestException on an illegal transition, returns the
   * target status on success.
   */
  assertTransition(from: OrderStatus, to: OrderStatus): OrderStatus {
    if (!canTransition(from, to)) {
      throw new BadRequestException(`Illegal order transition: ${from} -> ${to}`);
    }
    return to;
  }

  /**
   * Shopkeeper: the incoming order feed for their OWN shop, newest first,
   * filtered to a set of statuses (one UI tab). Keyset paginated — page 1 (no
   * cursor) holds the freshest orders in that tab; "load older" pages via
   * nextCursor. Filtering per-tab means an old still-active order never falls
   * behind newer completed ones (each tab only holds its own statuses).
   */
  async feedForShop(
    shopId: string | undefined,
    statuses?: OrderStatus[],
    page: PaginationQuery = {},
  ) {
    const id = requireShopScope(shopId);
    const rows = await this.prisma.order.findMany({
      where: {
        shopId: id,
        deletedAt: null,
        ...(statuses && statuses.length ? { status: { in: statuses } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(page.limit, page.cursor),
      select: SHOP_FEED_SELECT,
    });
    return toPage(rows, page.limit);
  }

  /**
   * Shopkeeper: order feed across ALL shops owned by the caller. Used when a
   * multi-shop owner wants a unified view without switching shops.
   */
  async feedForAllShops(
    userId: string,
    statuses?: OrderStatus[],
    page: PaginationQuery = {},
  ) {
    const shops = await this.prisma.shop.findMany({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true },
    });
    const shopIds = shops.map((s) => s.id);
    if (!shopIds.length) return { items: [], nextCursor: null };

    const rows = await this.prisma.order.findMany({
      where: {
        shopId: { in: shopIds },
        deletedAt: null,
        ...(statuses && statuses.length ? { status: { in: statuses } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(page.limit, page.cursor),
      select: SHOP_FEED_SELECT,
    });
    return toPage(rows, page.limit);
  }

  /** Per-status counts across all shops owned by the caller. */
  async feedCountsForAllShops(userId: string): Promise<Record<string, number>> {
    const shops = await this.prisma.shop.findMany({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true },
    });
    const shopIds = shops.map((s) => s.id);
    if (!shopIds.length) return {};

    const groups = await this.prisma.order.groupBy({
      by: ['status'],
      where: { shopId: { in: shopIds }, deletedAt: null },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const g of groups) counts[g.status] = g._count._all;
    return counts;
  }

  /**
   * Shopkeeper: per-status order counts for their OWN shop (drives the feed tab
   * badges). A cheap aggregate — no rows fetched — so it can be polled alongside
   * the paginated feed without shipping the whole table.
   */
  async feedCountsForShop(shopId: string | undefined): Promise<Record<string, number>> {
    const id = requireShopScope(shopId);
    const groups = await this.prisma.order.groupBy({
      by: ['status'],
      where: { shopId: id, deletedAt: null },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const g of groups) {
      counts[g.status] = g._count._all;
    }
    return counts;
  }

  /**
   * Shopkeeper home analytics for their OWN shop, over three windows: today,
   * last 7 days, and this month. Each window reports order count, delivered
   * count, and delivered order value (paise). Plus a live "active orders" count
   * (in-flight, any date). Scoped to the caller's shop.
   */
  async statsForShop(shopId: string | undefined) {
    const id = requireShopScope(shopId);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const ACTIVE: OrderStatus[] = [
      OrderStatus.PLACED,
      OrderStatus.ACCEPTED,
      OrderStatus.AWAITING_PAYMENT,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.OUT_FOR_DELIVERY,
    ];

    // Pull this month's orders once (superset of today + 7d) and aggregate in JS.
    const orders = await this.prisma.order.findMany({
      where: { shopId: id, deletedAt: null, createdAt: { gte: startOfMonth < sevenDaysAgo ? startOfMonth : sevenDaysAgo } },
      select: { status: true, originalTotalPaise: true, adjustedTotalPaise: true, createdAt: true },
    });

    const windowStats = (since: Date) => {
      const inWindow = orders.filter((o) => o.createdAt >= since);
      const delivered = inWindow.filter((o) => o.status === OrderStatus.DELIVERED);
      const valuePaise = delivered.reduce(
        (sum, o) => sum + (o.adjustedTotalPaise ?? o.originalTotalPaise),
        0,
      );
      return { orders: inWindow.length, delivered: delivered.length, valuePaise };
    };

    const activeCount = await this.prisma.order.count({
      where: { shopId: id, deletedAt: null, status: { in: ACTIVE } },
    });

    return {
      today: windowStats(startOfToday),
      last7Days: windowStats(sevenDaysAgo),
      thisMonth: windowStats(startOfMonth),
      activeOrders: activeCount,
    };
  }

  /**
   * Shopkeeper: advance an order in their OWN shop to the next status. Validates
   * the transition via the shared state machine and applies exception fields
   * (rejection reason, cancellation metadata) as appropriate.
   */
  async advanceStatus(
    shopId: string | undefined,
    orderId: string,
    dto: AdvanceOrderDto,
  ) {
    const id = requireShopScope(shopId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { id: true, shopId: true, status: true, customerId: true, pickupOtp: true, deliveryMode: true, paymentConfirmed: true, paymentMethod: true },
    });
    // 404 if missing OR another shop's order (no existence leak).
    const owned = assertOwnedByShop(order, id);

    // Validate against the shared state machine.
    this.assertTransition(owned.status as OrderStatus, dto.status);

    if (dto.status === OrderStatus.REJECTED && !dto.reason) {
      throw new BadRequestException('A rejection reason is required');
    }
    if (dto.status === OrderStatus.CANCELLED && !dto.reason) {
      throw new BadRequestException('A cancellation reason is required');
    }

    // Handoff OTP gate: to mark an order DELIVERED, the shop must enter the OTP
    // shown in the customer's app (proves the right customer received it). This
    // applies to both delivery and self-pickup.
    if (dto.status === OrderStatus.DELIVERED && owned.pickupOtp) {
      if (!dto.otp || !dto.otp.trim()) {
        throw new BadRequestException("Enter the customer’s handoff OTP to complete the order");
      }
      if (dto.otp.trim() !== owned.pickupOtp) {
        throw new BadRequestException("Wrong OTP — ask the customer for the correct 4-digit code");
      }
    }

    const data: {
      status: OrderStatus;
      rejectionReason?: string;
      cancelledBy?: CancelledBy;
      cancellationReason?: string;
      cancelledAt?: Date;
    } = { status: dto.status };

    if (dto.status === OrderStatus.REJECTED) {
      data.rejectionReason = dto.reason;
    }
    if (dto.status === OrderStatus.CANCELLED) {
      data.cancelledBy = CancelledBy.SHOP;
      data.cancellationReason = dto.reason;
      data.cancelledAt = new Date();
      // If customer already paid (UPI_DIRECT confirmed), force REFUND_PENDING
      // so admin is alerted and customer knows to request refund from the shop.
      if (owned.paymentConfirmed && owned.paymentMethod === 'UPI_DIRECT') {
        data.status = OrderStatus.REFUND_PENDING;
      }
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data,
      select: ORDER_MUTATION_SELECT,
    });

    // Auto-open a review dispute when the shop cancels / rejects an order (or a
    // paid order flips to REFUND_PENDING) so every such order lands in the admin
    // queue. Idempotent + best-effort (won't block the transition).
    if (
      data.status === OrderStatus.CANCELLED ||
      data.status === OrderStatus.REJECTED ||
      data.status === OrderStatus.REFUND_PENDING
    ) {
      const verb = data.status === OrderStatus.REJECTED ? 'rejected' : 'cancelled';
      await this.disputes.openSystemDispute(
        orderId,
        `Order ${verb} by shop${dto.reason ? ` — ${dto.reason}` : ''}.`,
      );
    }

    // On DELIVERED: accrue commission + platform fee to the shop's ledger and
    // enforce the credit limit (auto-pause at the ceiling). plan → Revenue Model.
    if (dto.status === OrderStatus.DELIVERED) {
      await this.ledger.accrueOnDelivery(orderId);
      // Qualify a pending referral (referee's 1st delivered order) → credit coins.
      await this.referrals.qualifyOnDelivery(owned.customerId);
      // NOTE: rider earnings + rider ledger are credited in riders.completeDelivery
      // (the only path a PLATFORM_RIDER order reaches DELIVERED). Self-delivery
      // orders have no rider, so nothing to credit here.
      // Bump per-product popularity (per-shop orderCount) for the popularity sort.
      const fulfilled = await this.prisma.orderItem.findMany({
        where: { orderId, status: 'FULFILLED' },
        select: { productId: true, qty: true },
      });
      for (const it of fulfilled) {
        await this.prisma.product.update({
          where: { id: it.productId },
          data: { orderCount: { increment: it.qty } },
        });
      }
    }

    // Live status update to the customer's room (tracking timeline).
    this.realtime.emitOrderStatusChanged(owned.customerId, {
      orderId,
      status: dto.status,
    });

    // When a platform-rider order becomes READY, start proximity dispatch: offer
    // it to the nearest online rider (the sweep re-offers on timeout). Best-effort.
    if (dto.status === OrderStatus.READY && owned.deliveryMode === DeliveryMode.PLATFORM_RIDER) {
      await this.dispatch.startForOrder(orderId).catch(() => undefined);
    }

    return updated;
  }

  /** Customer sends a one-time nudge to the shop (e.g. "Please hurry"). */
  async sendNudge(customerId: string, orderId: string, message: string) {
    if (!message?.trim()) throw new BadRequestException('Message is required');
    if (message.trim().length > 200) throw new BadRequestException('Message too long (max 200 chars)');

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId, deletedAt: null },
      select: { id: true, status: true, shopId: true, customerNudgedAt: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const NUDGEABLE = [OrderStatus.PLACED, OrderStatus.ACCEPTED, OrderStatus.AWAITING_PAYMENT, OrderStatus.PREPARING];
    if (!NUDGEABLE.includes(order.status as OrderStatus)) {
      throw new BadRequestException('You can only nudge the shop while the order is being prepared');
    }
    if (order.customerNudgedAt) {
      throw new BadRequestException('You can only send one nudge per order');
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { customerNudge: message.trim(), customerNudgedAt: new Date() },
      select: { id: true, customerNudge: true, customerNudgedAt: true },
    });

    // Notify the shop's feed in real-time (reuse statusChanged event with a custom status)
    this.realtime.emitOrderStatusChanged(order.shopId, { orderId, status: 'NUDGE' as never });

    return updated;
  }

  /** Customer accepts the shop's changes (removed items) — unblocks the order. */
  async acceptOrderChanges(customerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId, deletedAt: null },
      select: { id: true, status: true, shopId: true, items: { select: { status: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    const hasUnavail = order.items.some(i => i.status === 'UNAVAILABLE');
    if (!hasUnavail) throw new BadRequestException('No items have been marked unavailable');
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { customerAcceptedChanges: true },
      select: { id: true, customerAcceptedChanges: true },
    });
    // Notify the shop that customer accepted
    this.realtime.emitOrderStatusChanged(order.shopId, { orderId, status: 'CHANGES_ACCEPTED' as never });
    return updated;
  }
}
