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
  BulkOrderStatus,
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
import { WebPushService } from '../notifications/web-push.service';
import { CouponsService } from '../coupons/coupons.service';
import { AdvanceOrderDto } from './dto/advance-order.dto';
import { PlaceOrderDto } from './dto/place-order.dto';
import { POSCreateSaleDto } from './dto/pos-create-sale.dto';
import {
  CUSTOMER_DETAIL_SELECT,
  ORDER_MUTATION_SELECT,
  SHOP_FEED_SELECT,
} from './order-select';

/**
 * Bulk sub-order statuses that mean the child has LEFT the fulfilment flow.
 * A bulk order continues with the surviving shops when one bows out, so these
 * children are excluded from the envelope's progression gates and from the
 * "does anyone survive?" check in reconcileBulkOrderAfterChildExit.
 */
const BULK_EXITED_CHILD_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.REFUND_PENDING,
  OrderStatus.REFUNDED,
];

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
    private readonly webPush: WebPushService,
    private readonly coupons: CouponsService,
  ) {}

  /**
   * Fire a Web Push to a shop's owner (best-effort, never throws). Used so the
   * shopkeeper is alerted even when the app is backgrounded / phone locked.
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
      /* best-effort — never block the order flow on a push */
    }
  }

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
    // Pickup skips the address entirely. The address read is independent of the
    // shop/product reads below, so we kick it off here and await it in parallel
    // with them (Promise.all) rather than paying its round-trip serially.
    let addressId: string | null = null;
    let dropCoords: { latitude: unknown; longitude: unknown } | null = null;
    const addressPromise =
      !isPickup && dto.addressId
        ? this.prisma.address.findFirst({
            where: { id: dto.addressId, userId: customerId, deletedAt: null },
            select: { id: true, latitude: true, longitude: true },
          })
        : Promise.resolve(null);
    if (!isPickup && !dto.addressId) {
      throw new BadRequestException('A delivery address is required');
    }

    // Resolve the order source: CLIENT-CART path (dto.shopId + dto.items) or the
    // legacy server-cart path. Either way we normalise to a `cart`-shaped object
    // with `.shop` (incl. activeOffer) and `.items[].product` so the rest of the
    // flow is unchanged. The client cart is never trusted for price/stock — we
    // reload the products from the DB here.
    const shopInclude = {
      activeOffer: { select: { id: true, title: true, type: true, value: true, minOrderPaise: true, active: true } },
    };
    type NormalItem = { productId: string; qty: number; product: { id: string; name: string; pricePaise: number; stock: number; available: boolean; weightGrams: number | null } };
    let cart: { id: string | null; shopId: string; shop: any; items: NormalItem[] };

    if (dto.shopId && dto.items && dto.items.length > 0) {
      // Client cart: load the shop + referenced products + the address all in
      // parallel (they're independent) — one round-trip instead of three.
      const productIds = dto.items.map((i) => i.productId);
      const [shop, products, address] = await Promise.all([
        this.prisma.shop.findFirst({
          where: { id: dto.shopId, deletedAt: null },
          include: shopInclude,
        }),
        this.prisma.product.findMany({
          where: { id: { in: productIds }, shopId: dto.shopId, deletedAt: null },
          select: { id: true, name: true, pricePaise: true, stock: true, available: true, weightGrams: true },
        }),
        addressPromise,
      ]);
      if (!shop) throw new BadRequestException('Shop not found');
      if (!isPickup) {
        if (!address) throw new NotFoundException('Address not found');
        addressId = address.id;
        dropCoords = { latitude: address.latitude, longitude: address.longitude };
      }
      const byId = new Map(products.map((p) => [p.id, p]));
      const normItems: NormalItem[] = dto.items.map((i) => {
        const product = byId.get(i.productId);
        if (!product) throw new BadRequestException('A product in your cart is no longer available');
        return { productId: i.productId, qty: i.qty, product };
      });
      cart = { id: null, shopId: dto.shopId, shop, items: normItems };
    } else {
      // Legacy server-cart path (await the address alongside the cart read).
      const [serverCart, address] = await Promise.all([
        this.prisma.cart.findFirst({
          where: { customerId, deletedAt: null },
          include: {
            shop: { include: shopInclude },
            items: { include: { product: true } },
          },
        }),
        addressPromise,
      ]);
      if (!serverCart || serverCart.items.length === 0) {
        throw new BadRequestException('Cart is empty');
      }
      if (!isPickup) {
        if (!address) throw new NotFoundException('Address not found');
        addressId = address.id;
        dropCoords = { latitude: address.latitude, longitude: address.longitude };
      }
      cart = serverCart as unknown as typeof cart;
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

    // Load the shop's city config ONCE (rider radius + delivery tiers) instead of
    // Fetch city config for COD rule enforcement + rider availability checks.
    let cityCfg: {
      riderCheckRadiusMeters: number | null;
      deliveryTiersJson: string | null;
      codMinOrderPaise: number;
      codMaxPerDay: number;
      codCancelBlockAfter: number;
      codCancelWindowDays: number;
      codWindowHours: number;
      autoCancelMinutes: number;
      requireRiderForDelivery: boolean;
      platformFeePaise: number;
    } | null = null;
    if (cart.shop.city) {
      cityCfg = await this.prisma.serviceableCity.findFirst({
        where: { name: { equals: cart.shop.city, mode: 'insensitive' }, deletedAt: null },
        select: {
          riderCheckRadiusMeters: true,
          deliveryTiersJson: true,
          codMinOrderPaise: true,
          codMaxPerDay: true,
          codCancelBlockAfter: true,
          codCancelWindowDays: true,
          codWindowHours: true,
          autoCancelMinutes: true,
          requireRiderForDelivery: true,
          platformFeePaise: true,
        },
      });
    }

    // ── COD rules ──────────────────────────────────────────────────────────────
    if (dto.paymentMethod === PaymentMethod.COD) {
      // Rule: shop-level COD disable
      if ((cart.shop as unknown as { codEnabled: boolean }).codEnabled === false) {
        throw new BadRequestException('This shop does not accept Cash on Delivery');
      }

      // Rule: minimum order value for COD — checked after subtotal computed below
      const maxPerDay = cityCfg?.codMaxPerDay ?? 0;
      if (maxPerDay > 0) {
        const windowHours = cityCfg?.codWindowHours ?? 24;
        const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
        const todayCod = await this.prisma.order.count({
          where: {
            customerId,
            paymentMethod: PaymentMethod.COD,
            createdAt: { gte: since },
            status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] },
          },
        });
        if (todayCod >= maxPerDay) {
          throw new BadRequestException(
            `You can place at most ${maxPerDay} COD order${maxPerDay > 1 ? 's' : ''} per ${windowHours}h. Please pay via UPI.`,
          );
        }
      }

      // Rule: block COD after N customer-cancelled COD orders in the rolling window
      const blockAfter = cityCfg?.codCancelBlockAfter ?? 0;
      const windowDays = cityCfg?.codCancelWindowDays ?? 30;
      if (blockAfter > 0) {
        const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
        const recentCancels = await this.prisma.order.count({
          where: {
            customerId,
            paymentMethod: PaymentMethod.COD,
            status: OrderStatus.CANCELLED,
            cancelledBy: CancelledBy.CUSTOMER,
            cancelledAt: { gte: since },
          },
        });
        if (recentCancels >= blockAfter) {
          throw new BadRequestException(
            `You have cancelled ${recentCancels} COD orders in the last ${windowDays} days. Please use UPI for this order.`,
          );
        }
      }
    }
    // ── end COD rules ──────────────────────────────────────────────────────────

    // Guard: a PLATFORM_RIDER delivery can only be placed if a rider is nearby —
    // unless the city has disabled requireRiderForDelivery (show shops freely).
    if (deliveryMode === DeliveryMode.PLATFORM_RIDER && (cityCfg?.requireRiderForDelivery ?? true)) {
      const riderRadius = cityCfg?.riderCheckRadiusMeters ?? 5000;
      const hit = await this.prisma.$queryRawUnsafe<Array<{ ok: number }>>(
        `SELECT 1 AS ok FROM "RiderProfile" rp JOIN "Shop" s ON s.id = $1
           WHERE rp.online = TRUE AND rp.geog IS NOT NULL AND s.geog IS NOT NULL
             AND ST_DWithin(rp.geog, s.geog, $2)
           LIMIT 1`,
        cart.shopId,
        riderRadius,
      );
      if (hit.length === 0) {
        throw new BadRequestException(
          'No delivery rider is available near this shop right now. Please try self-pickup or try again shortly.',
        );
      }
    }

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
    // COD minimum order value (admin-configurable per city)
    if (dto.paymentMethod === PaymentMethod.COD) {
      const codMin = cityCfg?.codMinOrderPaise ?? 0;
      if (codMin > 0 && subtotalPaise < codMin) {
        throw new BadRequestException(
          `Minimum order value for COD is ₹${(codMin / 100).toFixed(0)}. Please add more items or pay via UPI.`,
        );
      }
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
      // Reuse the city config already loaded above (no second DB round-trip).
      if (cityCfg?.deliveryTiersJson) {
        const tiers: Array<{ maxKm: number; feePaise: number }> = JSON.parse(cityCfg.deliveryTiersJson);
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

    // Resolve coupon (code-based) — MUTUALLY EXCLUSIVE with an offer and with any
    // second coupon. A single order carries at most ONE discount source: enforce
    // it here, server-side. validate() checks city/shop scope, expiry, min-order,
    // and usage limits. A coupon can be shop-funded or NearBaz(platform)-funded.
    let coupon:
      | { id: string; code: string; type: string; value: number; minOrderPaise: number; maxDiscountPaise: number | null; fundedBy: string }
      | null = null;
    const couponCode = dto.couponCode?.trim();
    if (couponCode) {
      if (offer) {
        throw new BadRequestException('Apply either an offer or a coupon — not both.');
      }
      coupon = await this.coupons.validate(couponCode, customerId, cart.shopId, subtotalPaise);
    }

    // Feed the chosen discount source (offer OR coupon) through the SAME bill maths
    // — a coupon behaves exactly like an offer (percent/flat/free-delivery), only
    // its funding differs. maxDiscount cap applies to coupons (offers have none here).
    const bill = computeBill({
      subtotalPaise,
      deliveryFeePaise,
      freeDeliveryAbovePaise,
      offerType: (offer?.type ?? coupon?.type) as import('@passwaala/shared').OfferType | null ?? null,
      offerValue: offer?.value ?? coupon?.value ?? null,
      offerMinOrderPaise: offer?.minOrderPaise ?? coupon?.minOrderPaise ?? null,
      offerMaxDiscountPaise: coupon?.maxDiscountPaise ?? null,
      platformFeeOverridePaise: cityCfg?.platformFeePaise ?? null,
    });

    // Funding split. An OFFER or a SHOP-funded coupon is borne by the shop
    // (discountPaise — shop absorbs it, exactly like today). A NEARBAZ-funded
    // coupon is borne by the PLATFORM (nearbazDiscountPaise): NearBaz eats the
    // discount, the shop is commissioned on the full subtotal and its ledger is
    // never touched — the subsidy is recorded in PlatformLedgerEntry on delivery.
    const nearbazFunded = coupon?.fundedBy === 'NEARBAZ';
    const shopDiscountPaise = nearbazFunded ? 0 : bill.discountPaise;
    const nearbazDiscountPaise = nearbazFunded ? bill.discountPaise : 0;

    // NearBaz Coins redemption (1 coin = ₹1 = 100 paise). Discounts the item
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

    // Cancel fee: check if customer has a pending cancel fee from a prior COD cancellation.
    // If so, block COD and add the fee to this order total (collected via UPI to PassWala).
    const customerRecord = await this.prisma.user.findUnique({
      where: { id: customerId },
      select: { pendingCancelFeePaise: true, pendingCancelFeeShopId: true },
    });
    const pendingCancelFeePaise = customerRecord?.pendingCancelFeePaise ?? 0;
    const pendingCancelFeeShopId = customerRecord?.pendingCancelFeeShopId ?? null;
    if (pendingCancelFeePaise > 0 && dto.paymentMethod === PaymentMethod.COD) {
      throw new BadRequestException(
        `You have an outstanding cancellation fee of ₹${(pendingCancelFeePaise / 100).toFixed(2)}. Please pay your next order via UPI — the fee will be collected automatically.`,
      );
    }

    const totalPaise = bill.totalPaise - coinsRedeemedPaise_adjusted + pendingCancelFeePaise;

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
          discountPaise: shopDiscountPaise,
          nearbazDiscountPaise,
          offerId: bill.offerApplied && offer ? offer.id : null,
          offerTitle: bill.offerApplied && offer ? offer.title : null,
          couponId: bill.offerApplied && coupon ? coupon.id : null,
          couponCode: bill.offerApplied && coupon ? coupon.code : null,
          platformFeePaise: bill.platformFeePaise,
          deliveryFeePaise: bill.deliveryFeePaise,
          commissionRateSnapshot: cart.shop.commissionRate,
          idempotencyKey: dto.idempotencyKey,
          totalWeightGrams,
          cancelFeeLinePaise: pendingCancelFeePaise,
          cancelFeeShopId: pendingCancelFeePaise > 0 ? pendingCancelFeeShopId : null,
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
      // Clear pending cancel fee — it's now baked into this order.
      if (pendingCancelFeePaise > 0) {
        await tx.user.update({
          where: { id: customerId },
          data: { pendingCancelFeePaise: 0, pendingCancelFeeShopId: null },
        });
      }
      // Decrement stock for each ordered item (inventory integrity — the sale
      // reduces available stock immediately, in the same atomic transaction).
      // Parallelised: the per-item updates are independent, so firing them
      // together cuts N sequential round-trips to one await inside the tx.
      await Promise.all(
        items.map((it) =>
          tx.product.update({
            where: { id: it.productId },
            data: { stock: { decrement: it.qty } },
          }),
        ),
      );
      // Empty the server cart if this order came from one (client-cart path has none).
      if (cartId) {
        await tx.cartItem.deleteMany({ where: { cartId } });
        await tx.cart.delete({ where: { id: cartId } });
      }
      return order;
    });

    // Record coupon redemption (usage count + per-user history) once the order is
    // durably committed. Off the critical path — a failure here never unwinds a
    // placed order; the shop/platform funding was already snapshotted on the order.
    if (bill.offerApplied && coupon) {
      await this.coupons.recordUsage(coupon.id, customerId, created.id).catch(() => undefined);
    }

    // Off the durable path: live new-order alert to the shop's room. (Phase 1
    // reliability plan moves this onto a BullMQ queue with retries; the order is
    // already safe in the DB regardless of whether this emit lands.)
    this.realtime.emitOrderCreated(shopId, { orderId: created.id });
    // Background push so the shopkeeper is alerted even with the app closed /
    // phone locked (the in-app socket + polling only fire while the tab is open).
    const orderTotal = created.adjustedTotalPaise ?? created.originalTotalPaise;
    void this.pushToShopOwner(shopId, {
      title: '🛒 New order!',
      body: `New order for ₹${(orderTotal / 100).toFixed(2)} — tap to view.`,
      tag: `order-${created.id}`,
      url: '/',
    });

    // Auto-cancel after city-configured timeout (default 15 min) if shop doesn't respond.
    const autoCancelMs = (cityCfg?.autoCancelMinutes ?? 15) * 60 * 1000;
    setTimeout(() => { void this.cancelAsSystem(created.id); }, autoCancelMs);

    return this.toPlacedResult(created);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // In-store POS (counter) sale — shopkeeper-created walk-in cash sale
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Ring up an in-store POS sale for a walk-in customer. Shop-scoped (shopId from
   * the JWT, never the body). The sale is created DIRECTLY at DELIVERED, paid
   * CASH, marked paymentConfirmed, SELF_PICKUP, with NO delivery/platform fee and
   * NO commission (commission-free per the POS policy — no ledger accrual, so a
   * counter sale never adds to the shop's dues). Catalog lines re-read the trusted
   * product price + decrement stock atomically; free-text lines snapshot the
   * typed name/price.
   *
   * idempotencyKey makes offline replay exactly-once: a repeated key returns the
   * already-created sale rather than double-charging stock.
   */
  async placePos(shopId: string | undefined, dto: POSCreateSaleDto) {
    const sid = requireShopScope(shopId);
    if (!dto.idempotencyKey) throw new BadRequestException('idempotencyKey is required');
    if (dto.paymentMethod !== PaymentMethod.CASH) {
      throw new BadRequestException('POS sales are cash-only');
    }
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Add at least one item');
    }

    // Idempotency / offline-replay guard: a repeated key returns the same sale.
    const prior = await this.prisma.order.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      select: { id: true, shopId: true },
    });
    if (prior) {
      if (prior.shopId !== sid) throw new ForbiddenException('Idempotency key belongs to another shop');
      return this.toPosResult(prior.id);
    }

    // Split catalog vs free-text lines. Validate each.
    const catalogLines: { productId: string; qty: number }[] = [];
    const freeTextLines: { name: string; pricePaise: number; qty: number }[] = [];
    for (const it of dto.items) {
      if (!Number.isInteger(it.qty) || it.qty < 1) {
        throw new BadRequestException('Item quantity must be at least 1');
      }
      if (it.productId) {
        catalogLines.push({ productId: it.productId, qty: it.qty });
      } else {
        if (!it.name || !it.name.trim()) throw new BadRequestException('Each free-text item needs a name');
        if (!Number.isInteger(it.pricePaise) || (it.pricePaise ?? -1) < 0) {
          throw new BadRequestException('Item price must be a non-negative integer (paise)');
        }
        freeTextLines.push({ name: it.name.trim(), pricePaise: it.pricePaise as number, qty: it.qty });
      }
    }

    // Re-read trusted product data for catalog lines (price/stock/name from DB —
    // never trust client price). Must all belong to THIS shop.
    const products = catalogLines.length
      ? await this.prisma.product.findMany({
          where: { id: { in: catalogLines.map((l) => l.productId) }, shopId: sid, deletedAt: null },
          select: { id: true, name: true, pricePaise: true, stock: true, available: true },
        })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    const resolvedCatalog = catalogLines.map((l) => {
      const p = byId.get(l.productId);
      if (!p) throw new BadRequestException('One or more products are not from this shop');
      if (!p.available || p.stock < l.qty) throw new BadRequestException(`"${p.name}" is out of stock`);
      return { productId: p.id, name: p.name, pricePaise: p.pricePaise, qty: l.qty };
    });

    const allLines = [
      ...resolvedCatalog,
      ...freeTextLines.map((l) => ({ productId: null as string | null, name: l.name, pricePaise: l.pricePaise, qty: l.qty })),
    ];
    const subtotalPaise = allLines.reduce((s, l) => s + l.pricePaise * l.qty, 0);

    // Resolve (or lazily create) this shop's synthetic "Walk-in" customer so the
    // required Order.customerId FK is satisfied without a nullable-FK migration.
    const walkInPhone = `pos:${sid}`;
    const walkIn = await this.prisma.user.upsert({
      where: { phone_appType: { phone: walkInPhone, appType: 'CUSTOMER' } },
      update: {},
      create: { phone: walkInPhone, appType: 'CUSTOMER', name: 'Walk-in Customer' },
      select: { id: true },
    });

    const orderId = randomUUID();
    const orderShortId = `OR${orderId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.order.create({
        data: {
          id: orderId,
          shortId: orderShortId,
          customerId: walkIn.id,
          shopId: sid,
          status: OrderStatus.DELIVERED, // counter sale is complete on creation
          paymentMethod: PaymentMethod.CASH,
          paymentConfirmed: true,
          deliveryMode: DeliveryMode.SELF_PICKUP,
          addressId: null,
          originalTotalPaise: subtotalPaise,
          platformFeePaise: 0,
          deliveryFeePaise: 0,
          commissionRateSnapshot: 0, // commission-free — never accrues shop dues
          idempotencyKey: dto.idempotencyKey,
          isPosSale: true,
          items: {
            create: allLines.map((l) => ({
              productId: l.productId,
              nameSnapshot: l.name,
              pricePaiseSnapshot: l.pricePaise,
              qty: l.qty,
            })),
          },
        },
      });
      // Decrement stock for catalog lines only (free-text lines have no product).
      await Promise.all(
        resolvedCatalog.map((l) =>
          tx.product.update({ where: { id: l.productId }, data: { stock: { decrement: l.qty } } }),
        ),
      );
    });

    return this.toPosResult(orderId);
  }

  /** Build the POS sale result (printed-receipt payload) from a committed order. */
  private async toPosResult(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        shortId: true,
        shopId: true,
        status: true,
        paymentMethod: true,
        originalTotalPaise: true,
        createdAt: true,
        items: { select: { nameSnapshot: true, pricePaiseSnapshot: true, qty: true } },
      },
    });
    if (!order) throw new NotFoundException('Sale not found');
    const items = order.items.map((i) => ({ name: i.nameSnapshot, pricePaise: i.pricePaiseSnapshot, qty: i.qty }));
    const subtotalPaise = items.reduce((s, i) => s + i.pricePaise * i.qty, 0);
    return {
      orderId: order.id,
      shortId: order.shortId,
      shopId: order.shopId,
      status: order.status as OrderStatus,
      items,
      subtotalPaise,
      totalPaise: order.originalTotalPaise,
      paymentMethod: order.paymentMethod as PaymentMethod,
      createdAt: order.createdAt.toISOString(),
    };
  }
  async cancelAsSystem(orderId: string, reason = 'No response from shop within 15 minutes'): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, status: OrderStatus.PLACED, deletedAt: null },
      select: { id: true, shortId: true, customerId: true, shopId: true, bulkOrderId: true, coinsRedeemedPaise: true, items: { select: { productId: true, qty: true } } },
    });
    if (!order) return; // already accepted, cancelled, or delivered — nothing to do

    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CANCELLED, cancelledBy: CancelledBy.SYSTEM, cancellationReason: reason, cancelledAt: new Date() },
      }),
      ...order.items
        .filter((item): item is { productId: string; qty: number } => item.productId != null)
        .map((item) =>
          this.prisma.product.update({ where: { id: item.productId }, data: { stock: { increment: item.qty } } }),
        ),
      ...(order.coinsRedeemedPaise > 0
        ? [this.prisma.user.update({ where: { id: order.customerId }, data: { coinBalance: { increment: order.coinsRedeemedPaise } } })]
        : []),
    ]);

    this.realtime.emitOrderStatusChanged(order.customerId, { orderId: order.id, status: OrderStatus.CANCELLED });
    await this.disputes.openSystemDispute(order.id, `${reason} — auto-cancelled by system.`, { onlyIfRefundOwed: true });
    // If this was a bulk sub-order, reconcile the envelope (continue with any
    // surviving shops, or cancel the bulk if this was the last one).
    if (order.bulkOrderId) {
      await this.reconcileBulkOrderAfterChildExit(order.bulkOrderId, order.customerId).catch(() => undefined);
    }
  }

  /**
   * Customer: their order history (newest first), each with a summary. Keyset
   * paginated — pass the previous page's nextCursor to fetch older orders.
   */
  async historyForCustomer(customerId: string, page: PaginationQuery = {}, mode?: string) {
    // Terminal statuses = the "History" tab; everything else is "Ongoing".
    // Splitting server-side lets each tab fetch only its own rows (ongoing loads
    // instantly on app open; history paginates independently).
    const TERMINAL = [
      OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REJECTED,
      OrderStatus.REFUND_PENDING, OrderStatus.REFUNDED,
    ];
    const statusWhere =
      mode === 'ongoing' ? { status: { notIn: TERMINAL } }
      : mode === 'history' ? { status: { in: TERMINAL } }
      : {};
    const rows = await this.prisma.order.findMany({
      where: { customerId, deletedAt: null, ...statusWhere },
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
   * Customer: append items to a live order.
   *
   * Allowed statuses: PLACED, ACCEPTED, AWAITING_PAYMENT, PREPARING.
   * Blocked at READY and beyond — the shop is already packing or dispatching.
   *
   * Payment delta:
   * - COD: adjustedTotalPaise updated; customer pays the new total at delivery.
   * - AWAITING_PAYMENT (UPI not yet confirmed): adjustedTotalPaise updated;
   *   the existing UPI Pay-Now link picks up the new total automatically.
   * - Prepaid (UPI_DIRECT + paymentConfirmed): customer already paid the
   *   original amount. The delta is stored in addedItemsDuePaise for
   *   rider/shop to collect at the door.
   */
  async addItemsToOrder(
    customerId: string,
    orderId: string,
    lines: Array<{ productId: string; qty: number }>,
  ) {
    if (!lines.length) throw new BadRequestException('No items provided');

    const ALLOWED = [
      OrderStatus.PLACED, OrderStatus.ACCEPTED,
      OrderStatus.AWAITING_PAYMENT, OrderStatus.PREPARING,
    ];

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId, deletedAt: null },
      select: {
        id: true, shortId: true, shopId: true, status: true,
        paymentMethod: true, paymentConfirmed: true,
        originalTotalPaise: true, adjustedTotalPaise: true,
        addedItemsDuePaise: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (!ALLOWED.includes(order.status as OrderStatus)) {
      throw new BadRequestException(
        `Cannot add items — order is already ${order.status}`,
      );
    }

    const productIds = lines.map((l) => l.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, shopId: order.shopId, deletedAt: null },
      select: { id: true, name: true, pricePaise: true, stock: true, available: true, weightGrams: true },
    });

    if (products.length !== productIds.length) {
      throw new BadRequestException('One or more products not found in this shop');
    }

    const productMap = new Map(products.map((p) => [p.id, p]));
    const newItems = lines.map((l) => {
      const p = productMap.get(l.productId)!;
      if (!p.available) throw new BadRequestException(`"${p.name}" is not available`);
      if (p.stock < l.qty) throw new BadRequestException(`"${p.name}" does not have enough stock`);
      return {
        orderId,
        productId: l.productId,
        nameSnapshot: p.name,
        pricePaiseSnapshot: p.pricePaise,
        weightGramsSnapshot: (p as { weightGrams?: number | null }).weightGrams ?? null,
        qty: l.qty,
      };
    });

    const subtotalDelta = newItems.reduce(
      (sum, it) => sum + it.pricePaiseSnapshot * it.qty, 0,
    );
    const existingTotal = order.adjustedTotalPaise ?? order.originalTotalPaise;
    const newTotal = existingTotal + subtotalDelta;

    const isPrepaid = order.paymentMethod === PaymentMethod.UPI_DIRECT && order.paymentConfirmed;
    const newDue = isPrepaid ? order.addedItemsDuePaise + subtotalDelta : order.addedItemsDuePaise;

    await this.prisma.$transaction(async (tx) => {
      // Fetch existing order items to merge quantities instead of creating duplicates
      const existingItems = await tx.orderItem.findMany({
        where: { orderId, status: 'FULFILLED' },
        select: { id: true, productId: true, qty: true },
      });
      const existingMap = new Map(existingItems.map(i => [i.productId, i]));

      const toCreate = newItems.filter(i => !existingMap.has(i.productId));
      const toUpdate = newItems.filter(i => existingMap.has(i.productId));

      if (toCreate.length > 0) {
        await tx.orderItem.createMany({ data: toCreate });
      }
      for (const item of toUpdate) {
        const existing = existingMap.get(item.productId)!;
        await tx.orderItem.update({
          where: { id: existing.id },
          data: { qty: { increment: item.qty } },
        });
      }
      await Promise.all(
        lines.map((l) =>
          tx.product.update({ where: { id: l.productId }, data: { stock: { decrement: l.qty } } }),
        ),
      );
      await tx.order.update({
        where: { id: orderId },
        data: { adjustedTotalPaise: newTotal, addedItemsDuePaise: newDue },
      });
    });

    this.realtime.emitOrderShopUpdate(order.shopId, { orderId, status: order.status });
    this.realtime.emitOrderStatusChanged(customerId, { orderId, status: order.status });
    void this.pushToShopOwner(order.shopId, {
      title: 'Items added to your order',
      body: `Customer added ${newItems.length} item(s) to order #${order.shortId ?? orderId.slice(0, 8).toUpperCase()}`,
      tag: `order-items-added-${orderId}`,
    });

    return { addedCount: newItems.length, newTotalPaise: newTotal, addedItemsDuePaise: newDue, isPrepaid };
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
   * Customer: claim they've paid a UPI order ("I've paid"). NearBaz is NOT in
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
    this.realtime.emitOrderShopUpdate(order.shopId, {
      orderId,
      status: order.status as OrderStatus,
    });
    // Background push: shop must verify the payment claim (action required).
    void this.pushToShopOwner(order.shopId, {
      title: '💳 Payment claimed',
      body: 'A customer says they paid — tap to verify and start preparing.',
      tag: `pay-${orderId}`,
      url: '/',
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
      // Free-text prescription lines have no catalog product — can't be re-carted.
      if (!item.productId) {
        skipped.push(item.nameSnapshot);
        continue;
      }
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
      await this.disputes.openSystemDispute(orderId, 'All items are out of stock — order cancelled by shop.', { onlyIfRefundOwed: true });
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
      data: { adjustedTotalPaise, itemsChangedAt: new Date() },
    });
    this.realtime.emitOrderStatusChanged(owned.customerId, {
      orderId,
      status: owned.status as OrderStatus,
    });
    return { adjustedTotalPaise: updated.adjustedTotalPaise };
  }

  /**
   * Shopkeeper: move a paid-but-unfulfillable order to REFUND_PENDING (the rare
   * money-already-paid case). NearBaz records the dispute; the shop refunds the
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
  // ─── Customer cancellation ────────────────────────────────────────────────

  /**
   * Customer requests cancellation:
   * - PLACED / ACCEPTED / AWAITING_PAYMENT → instant free cancel.
   * - PREPARING → stores a cancel request; shop must approve/deny.
   * - READY and beyond → blocked.
   */
  async requestCancel(customerId: string, orderId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('A cancellation reason is required');

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId, deletedAt: null },
      select: {
        id: true, status: true, shopId: true,
        originalTotalPaise: true, adjustedTotalPaise: true,
        paymentMethod: true, paymentConfirmed: true,
        cancelRequestedAt: true, bulkOrderId: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    const INSTANT_CANCEL = [
      OrderStatus.PLACED, OrderStatus.ACCEPTED, OrderStatus.AWAITING_PAYMENT,
    ];
    const NEEDS_APPROVAL = [OrderStatus.PREPARING];
    const BLOCKED = [
      OrderStatus.READY, OrderStatus.RIDER_ASSIGNED, OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REJECTED,
      OrderStatus.REFUND_PENDING, OrderStatus.REFUNDED,
    ];

    if (BLOCKED.includes(order.status as OrderStatus)) {
      throw new BadRequestException(`Cannot cancel an order in ${order.status} status`);
    }
    if (order.cancelRequestedAt) {
      throw new BadRequestException('A cancellation request is already pending');
    }

    if (INSTANT_CANCEL.includes(order.status as OrderStatus)) {
      // Instant free cancel — same as admin cancel but by customer
      const isPrepaid = order.paymentMethod === PaymentMethod.UPI_DIRECT && order.paymentConfirmed;
      const newStatus = isPrepaid ? OrderStatus.REFUND_PENDING : OrderStatus.CANCELLED;
      await this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: newStatus,
          cancelledBy: CancelledBy.CUSTOMER,
          cancellationReason: reason.trim(),
          cancelledAt: new Date(),
        },
      });
      this.realtime.emitOrderStatusChanged(customerId, { orderId, status: newStatus });
      this.realtime.emitOrderShopUpdate(order.shopId, { orderId, status: newStatus });
      if (isPrepaid) {
        await this.disputes.openSystemDispute(orderId, `Customer cancelled before preparation — refund required`);
      }
      // Bulk sub-order: reconcile the envelope (continue with survivors, or
      // cancel the bulk if this was the last one).
      if (order.bulkOrderId) {
        await this.reconcileBulkOrderAfterChildExit(order.bulkOrderId, customerId).catch(() => undefined);
      }
      return { cancelled: true, requiresShopApproval: false, feePaise: 0 };
    }

    // PREPARING → request needs shop approval; look up shop's cancel fee rate
    const shop = await this.prisma.shop.findUnique({
      where: { id: order.shopId },
      select: { cancelFeeRatePct: true },
    });
    const rate = Math.min(shop?.cancelFeeRatePct ?? 0, 0.10); // cap at 10%
    const total = order.adjustedTotalPaise ?? order.originalTotalPaise;
    const feePaise = Math.round(total * rate);

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        cancelRequestedAt: new Date(),
        cancelRequestReason: reason.trim(),
        cancelFeePaise: feePaise,
      },
    });
    this.realtime.emitOrderShopUpdate(order.shopId, { orderId, status: order.status });
    void this.pushToShopOwner(order.shopId, {
      title: 'Cancel request received',
      body: `Customer wants to cancel order #${order.id.slice(0, 8).toUpperCase()}. Please approve or deny.`,
      tag: `cancel-req-${orderId}`,
    });
    return { cancelled: false, requiresShopApproval: true, feePaise };
  }

  /**
   * Shop approves customer's cancel request. The cancel fee (if any) is:
   * - 50% credited to the shop's ledger (compensation for prep work)
   * - 50% retained by PassWala
   * If the order was prepaid, it moves to REFUND_PENDING (net of fee).
   */
  async approveCancelRequest(shopId: string | undefined, orderId: string) {
    const id = requireShopScope(shopId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, shopId: id, deletedAt: null },
      select: {
        id: true, status: true, shopId: true, customerId: true,
        paymentMethod: true, paymentConfirmed: true,
        cancelFeePaise: true, cancelRequestedAt: true,
        originalTotalPaise: true, adjustedTotalPaise: true, bulkOrderId: true,
      },
    });
    assertOwnedByShop(order, id);
    if (!order?.cancelRequestedAt) throw new BadRequestException('No cancel request pending');
    if (order.status !== OrderStatus.PREPARING) {
      throw new BadRequestException('Order is no longer in PREPARING status');
    }

    const feePaise = order.cancelFeePaise ?? 0;
    const isPrepaid = order.paymentMethod === PaymentMethod.UPI_DIRECT && order.paymentConfirmed;
    const newStatus = isPrepaid ? OrderStatus.REFUND_PENDING : OrderStatus.CANCELLED;

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: newStatus,
          cancelledBy: CancelledBy.CUSTOMER,
          cancellationReason: 'Customer request — approved by shop',
          cancelledAt: new Date(),
          cancelRequestedAt: null,
        },
      });
      if (feePaise > 0) {
        if (isPrepaid) {
          // UPI order: shop gets 50% compensation (they prepared but payment was made).
          const shopSharePaise = Math.round(feePaise / 2);
          await tx.ledgerEntry.create({
            data: {
              shopId: order.shopId,
              orderId,
              type: 'REFERRAL_CREDIT' as any,
              basePaise: -shopSharePaise,
              gstPaise: 0,
              totalPaise: -shopSharePaise,
              status: 'ACCRUED' as any,
            },
          });
        } else {
          // COD order: shop gets 0% (no money ever changed hands — shop loses nothing).
          // Full fee goes to PassWala. Customer carries it as pending balance.
          await tx.user.update({
            where: { id: order.customerId },
            data: {
              pendingCancelFeePaise: { increment: feePaise },
              pendingCancelFeeShopId: order.shopId,
            },
          });
        }
      }
    });

    this.realtime.emitOrderStatusChanged(order.customerId, { orderId, status: newStatus });
    this.realtime.emitOrderShopUpdate(id, { orderId, status: newStatus });
    if (isPrepaid) {
      await this.disputes.openSystemDispute(
        orderId,
        `Customer cancel approved by shop. Refund required${feePaise > 0 ? ` (net of ₹${feePaise / 100} cancel fee)` : ''}.`,
      );
    }
    // Bulk sub-order: reconcile the envelope (continue with survivors, or cancel
    // the bulk if this was the last one).
    if (order.bulkOrderId) {
      await this.reconcileBulkOrderAfterChildExit(order.bulkOrderId, order.customerId).catch(() => undefined);
    }
    return { approved: true, feePaise };
  }

  /**
   * Shop denies customer's cancel request — order continues normally.
   */
  async denyCancelRequest(shopId: string | undefined, orderId: string) {
    const id = requireShopScope(shopId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, shopId: id, deletedAt: null },
      select: { id: true, status: true, shopId: true, customerId: true, cancelRequestedAt: true },
    });
    assertOwnedByShop(order, id);
    if (!order?.cancelRequestedAt) throw new BadRequestException('No cancel request pending');

    await this.prisma.order.update({
      where: { id: orderId },
      data: { cancelRequestedAt: null, cancelRequestReason: null, cancelFeePaise: null },
    });
    this.realtime.emitOrderStatusChanged(order.customerId, { orderId, status: order.status });
    return { denied: true };
  }

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
    this.realtime.emitOrderShopUpdate(order.shopId, {
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
      select: { id: true, shopId: true, status: true, customerId: true, pickupOtp: true, deliveryMode: true, paymentConfirmed: true, paymentMethod: true, bulkOrderId: true, riderId: true, shortId: true, shop: { select: { city: true } } },
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
        { onlyIfRefundOwed: true },
      );
    }

    // On DELIVERED: accrue commission + platform fee to the shop's ledger and
    // enforce the credit limit (auto-pause at the ceiling). plan → Revenue Model.
    if (dto.status === OrderStatus.DELIVERED) {
      await this.ledger.accrueOnDelivery(orderId);
      // Qualify a pending referral (referee's 1st delivered order) → credit coins.
      await this.referrals.qualifyOnDelivery(owned.customerId, owned.shop?.city ?? undefined);
      // NOTE: rider earnings + rider ledger are credited in riders.completeDelivery
      // (the only path a PLATFORM_RIDER order reaches DELIVERED). Self-delivery
      // orders have no rider, so nothing to credit here.
      // Bump per-product popularity (per-shop orderCount) for the popularity sort.
      const fulfilled = await this.prisma.orderItem.findMany({
        where: { orderId, status: 'FULFILLED', productId: { not: null } },
        select: { productId: true, qty: true },
      });
      for (const it of fulfilled) {
        if (!it.productId) continue;
        await this.prisma.product.update({
          where: { id: it.productId },
          data: { orderCount: { increment: it.qty } },
        });
      }
      // Bump shop-level popularity + recency signals for rankScore (recomputed by
      // AutomationService.recomputeShopRankScores). Delivered (not merely placed)
      // orders are the honest popularity signal — a cancelled order won't rank a
      // shop up. lastOrderAt drives the recency-of-activity term.
      await this.prisma.shop.update({
        where: { id: owned.shopId },
        data: { orderCount: { increment: 1 }, lastOrderAt: new Date() },
      }).catch(() => undefined);
      // Cancel fee split: if this order carried a cancel fee line, credit 50%
      // to the original shop and PassWala keeps the other 50%.
      const cancelOrder = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { cancelFeeLinePaise: true, cancelFeeShopId: true },
      });
      // COD cancel fee: full amount goes to PassWala (shop gets 0%).
      if ((cancelOrder?.cancelFeeLinePaise ?? 0) > 0) {
        // Nothing to write — fee was already collected via UPI in the order total.
        // PassWala keeps 100%. The audit trail is on Order.cancelFeeLinePaise.
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
      if (owned.bulkOrderId) {
        // For bulk sub-orders: check if ALL sub-orders are READY; if so dispatch the envelope.
        await this.maybeTriggerBulkDispatch(owned.bulkOrderId).catch(() => undefined);
      } else {
        await this.dispatch.startForOrder(orderId).catch(() => undefined);
      }
    }

    // When a bulk sub-order is ACCEPTED, check if all sub-orders are accepted.
    if (dto.status === OrderStatus.ACCEPTED && owned.bulkOrderId) {
      await this.maybeAdvanceBulkToAcceptedAll(owned.bulkOrderId).catch(() => undefined);
    }

    // When a bulk sub-order leaves the flow (REJECTED / CANCELLED / forced to
    // REFUND_PENDING because it was paid), reconcile the envelope: the bulk
    // CONTINUES with the surviving shops; the whole bulk is cancelled only if
    // no shop survives. The departing shop's refund is handled by the dispute
    // opened above (onlyIfRefundOwed).
    if (
      (data.status === OrderStatus.REJECTED ||
        data.status === OrderStatus.CANCELLED ||
        data.status === OrderStatus.REFUND_PENDING) &&
      owned.bulkOrderId
    ) {
      await this.reconcileBulkOrderAfterChildExit(owned.bulkOrderId, owned.customerId).catch(() => undefined);
    }

    // If a rider was already assigned to THIS sub-order (or single order) and it
    // is now being pulled from the flow, actively tell that rider and detach the
    // order from them so it leaves their board. (The bulk envelope's rider stays
    // on the route for the surviving shops; only the full-cancel path in
    // reconcileBulkOrderAfterChildExit releases the envelope rider.)
    if (
      (data.status === OrderStatus.REJECTED ||
        data.status === OrderStatus.CANCELLED ||
        data.status === OrderStatus.REFUND_PENDING) &&
      owned.riderId
    ) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { riderId: null },
      }).catch(() => undefined);
      await this.notifyRiderJobRemoved(
        owned.riderId,
        `Order #${(owned.shortId ?? orderId).slice(0, 10)} was cancelled by the shop — removed from your deliveries.`,
      ).catch(() => undefined);
    }

    // Re-fetch the BulkOrder status after any hooks have run and emit it to the
    // customer's tracking screen so it reflects the latest aggregate state.
    if (owned.bulkOrderId) {
      const bulkStatus = await this.prisma.bulkOrder.findUnique({
        where: { id: owned.bulkOrderId },
        select: { status: true },
      }).catch(() => null);
      if (bulkStatus) {
        this.realtime.emitOrderStatusChanged(owned.customerId, {
          orderId: owned.bulkOrderId,
          status: bulkStatus.status as unknown as OrderStatus,
        });
      }
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
    this.realtime.emitOrderShopUpdate(order.shopId, { orderId, status: 'NUDGE' as never });

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
    this.realtime.emitOrderShopUpdate(order.shopId, { orderId, status: 'CHANGES_ACCEPTED' as never });
    return updated;
  }

  /** When a bulk sub-order becomes ACCEPTED, check if all siblings are accepted too. */
  private async maybeAdvanceBulkToAcceptedAll(bulkOrderId: string): Promise<void> {
    const bulk = await this.prisma.bulkOrder.findUnique({
      where: { id: bulkOrderId },
      select: { id: true, status: true, orders: { select: { status: true } } },
    });
    if (!bulk || bulk.status !== BulkOrderStatus.PLACED) return;
    const survivors = bulk.orders.filter(
      (o) => !BULK_EXITED_CHILD_STATUSES.includes(o.status as OrderStatus),
    );
    const allAccepted = survivors.length > 0 && survivors.every(
      (o) => [
        OrderStatus.ACCEPTED, OrderStatus.AWAITING_PAYMENT,
        OrderStatus.PREPARING, OrderStatus.READY,
      ].includes(o.status as OrderStatus),
    );
    if (allAccepted) {
      await this.prisma.bulkOrder.update({
        where: { id: bulkOrderId },
        data: { status: BulkOrderStatus.ACCEPTED_ALL },
      });
    }
  }

  /**
   * Reconcile a BulkOrder after one of its sub-orders LEAVES the fulfilment flow
   * (rejected / cancelled / paid-then-cancelled). Product policy: the bulk order
   * CONTINUES with the surviving shops — the departing shop's part is refunded
   * (a per-child refund dispute is opened by the caller when money is owed).
   *
   *  - If shops still survive: re-run the accepted-all / ready-all gates (the
   *    departing shop may have been the last blocker) and push the refreshed
   *    envelope status to the customer. The bulk is NOT cancelled.
   *  - If NO shops survive (every sub-order has exited): cancel the envelope and
   *    emit BULK_CANCELLED.
   */
  private async reconcileBulkOrderAfterChildExit(
    bulkOrderId: string,
    customerId: string,
  ): Promise<void> {
    const subOrders = await this.prisma.order.findMany({
      where: { bulkOrderId, deletedAt: null },
      select: { id: true, status: true },
    });

    const survivors = subOrders.filter(
      (o) => !BULK_EXITED_CHILD_STATUSES.includes(o.status as OrderStatus),
    );

    if (survivors.length === 0) {
      // Every shop has bowed out — nothing left to fulfil. Cancel the envelope
      // and release any assigned rider (the whole route is gone).
      const bulk = await this.prisma.bulkOrder.findUnique({
        where: { id: bulkOrderId },
        select: { riderId: true, shortId: true },
      });
      await this.prisma.bulkOrder.update({
        where: { id: bulkOrderId },
        data: { status: BulkOrderStatus.CANCELLED, riderId: null },
      });
      if (bulk?.riderId) {
        await this.notifyRiderJobRemoved(
          bulk.riderId,
          `Bulk order #${(bulk.shortId ?? bulkOrderId).slice(0, 10)} was cancelled — removed from your deliveries.`,
        );
      }
      this.realtime.emitOrderStatusChanged(customerId, {
        orderId: bulkOrderId,
        status: 'BULK_CANCELLED' as unknown as OrderStatus,
      });
      return;
    }

    // Survivors remain → the bulk continues. A departing shop may have been the
    // last blocker on a progression gate, so re-run the accepted / ready checks.
    await this.maybeAdvanceBulkToAcceptedAll(bulkOrderId).catch(() => undefined);
    await this.maybeTriggerBulkDispatch(bulkOrderId).catch(() => undefined);

    // Push the refreshed envelope status to the customer's tracking screen.
    const bulk = await this.prisma.bulkOrder.findUnique({
      where: { id: bulkOrderId },
      select: { status: true },
    }).catch(() => null);
    if (bulk) {
      this.realtime.emitOrderStatusChanged(customerId, {
        orderId: bulkOrderId,
        status: bulk.status as unknown as OrderStatus,
      });
    }
  }

  /**
   * Notify a rider that a job was pulled out from under them (shop cancelled a
   * paid order after assignment, etc.) and refresh their board. Best-effort:
   * a system.alert socket event (the rider app reloads on it) + a push.
   */
  private async notifyRiderJobRemoved(riderId: string, message: string): Promise<void> {
    try {
      this.realtime.emitSystemAlert(riderId, { message });
    } catch { /* best-effort */ }
    try {
      await this.webPush.sendToUser(riderId, {
        title: 'Delivery cancelled',
        body: message,
        tag: `job-removed-${riderId}`,
      });
    } catch { /* best-effort */ }
  }

  /** When a bulk sub-order becomes READY, check if all siblings are READY → dispatch. */
  private async maybeTriggerBulkDispatch(bulkOrderId: string): Promise<void> {
    const bulk = await this.prisma.bulkOrder.findUnique({
      where: { id: bulkOrderId },
      select: { id: true, status: true, orders: { select: { status: true } } },
    });
    if (!bulk) return;
    const survivors = bulk.orders.filter(
      (o) => !BULK_EXITED_CHILD_STATUSES.includes(o.status as OrderStatus),
    );
    const allReady = survivors.length > 0 && survivors.every((o) => o.status === OrderStatus.READY);
    if (allReady && (bulk.status === BulkOrderStatus.ACCEPTED_ALL || bulk.status === BulkOrderStatus.PLACED)) {
      await this.prisma.bulkOrder.update({
        where: { id: bulkOrderId },
        data: { status: BulkOrderStatus.READY_ALL },
      });
      await this.dispatch.startForBulkOrder(bulkOrderId);
    }
  }
}
