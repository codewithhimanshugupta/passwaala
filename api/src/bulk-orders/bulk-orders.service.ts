import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  BulkOrderStatus,
  DeliveryMode,
  OrderStatus,
  PaymentMethod,
  computeBill,
  haversineMeters,
  platformDeliveryFeePaise,
  MAX_BULK_SHOP_PROXIMITY_METERS,
  MAX_SHOPS_PER_BULK_ORDER,
  MULTI_SHOP_SURCHARGE_PAISE,
  PLATFORM_FEE_PAISE,
} from '@nearbaz/shared';
import { computeGst } from '@nearbaz/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { WebPushService } from '../notifications/web-push.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { PlaceBulkOrderDto } from './dto/place-bulk-order.dto';

/**
 * Child statuses that mean the sub-order has LEFT the bulk fulfilment flow —
 * cancelled/rejected outright, or paid-then-cancelled and awaiting refund. Per
 * product policy, a bulk order CONTINUES with the surviving shops when one shop
 * bows out, so these children are excluded from the "are we all there yet?"
 * progression gates below (accepted-all / ready-all / picked-up / delivered).
 */
const EXITED_CHILD_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.REFUND_PENDING,
  OrderStatus.REFUNDED,
];

/** Fields fetched for each shop during bulk placement. */
const SHOP_SELECT = {
  id: true,
  name: true,
  city: true,
  latitude: true,
  longitude: true,
  verificationStatus: true,
  isOpen: true,
  platformDeliveryEnabled: true,
  deliveryFeePaise: true,
  freeDeliveryAbovePaise: true,
  minOrderValuePaise: true,
  commissionRate: true,
  activeOffer: {
    select: {
      id: true,
      title: true,
      type: true,
      value: true,
      minOrderPaise: true,
    },
  },
} as const;

function generateOtp(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function generateShortId(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

@Injectable()
export class BulkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly webPush: WebPushService,
    private readonly dispatch: DispatchService,
  ) {}

  /**
   * Place a bulk order spanning multiple shops. Atomic: creates BulkOrder +
   * N sub-Orders + decrements stock in a single transaction.
   */
  async place(customerId: string, dto: PlaceBulkOrderDto) {
    // Idempotency check
    const prior = await this.prisma.bulkOrder.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { orders: { select: { id: true, shopId: true } } },
    });
    if (prior) {
      if (prior.customerId !== customerId) {
        throw new ForbiddenException('Idempotency key belongs to another user');
      }
      return { bulkOrderId: prior.id, shortId: prior.shortId, orderIds: prior.orders.map((o) => o.id) };
    }

    if (dto.shops.length < 2) throw new BadRequestException('Bulk order requires at least 2 shops');
    if (dto.shops.length > MAX_SHOPS_PER_BULK_ORDER) {
      throw new BadRequestException(`Maximum ${MAX_SHOPS_PER_BULK_ORDER} shops per bulk order`);
    }

    // Validate address belongs to customer
    const address = await this.prisma.address.findFirst({
      where: { id: dto.addressId, userId: customerId, deletedAt: null },
      select: { id: true, latitude: true, longitude: true },
    });
    if (!address) throw new NotFoundException('Address not found');

    const dropCoords = { latitude: address.latitude, longitude: address.longitude };

    // Load all shops + their products in parallel
    const shopIds = dto.shops.map((s) => s.shopId);
    const allProductIds = dto.shops.flatMap((s) => s.items.map((i) => i.productId));

    const [shops, products, , coinBalance] = await Promise.all([
      this.prisma.shop.findMany({
        where: { id: { in: shopIds }, deletedAt: null },
        select: SHOP_SELECT,
      }),
      this.prisma.product.findMany({
        where: { id: { in: allProductIds }, deletedAt: null },
        select: { id: true, shopId: true, name: true, pricePaise: true, stock: true, weightGrams: true, available: true },
      }),
      // Will be set after shops are loaded — placeholder
      Promise.resolve(null) as Promise<null>,
      this.prisma.user.findUnique({
        where: { id: customerId },
        select: { coinBalance: true },
      }),
    ]);

    // Fetch city config based on the actual city of the anchor shop
    const anchorCity = shops.find(s => s.id === dto.shops[0].shopId)?.city ?? shops[0]?.city;
    const cityRow = anchorCity ? await this.prisma.serviceableCity.findFirst({
      where: { name: anchorCity, deletedAt: null },
      select: { multiShopSurchargePaise: true, deliveryTiersJson: true, deliveryRadiusMeters: true, bulkShopRadiusMeters: true },
    }) : null;

    // Validate every shop is present, approved, open, platform-delivery enabled
    for (const shopCart of dto.shops) {
      const shop = shops.find((s) => s.id === shopCart.shopId);
      if (!shop) throw new NotFoundException(`Shop ${shopCart.shopId} not found`);
      if (shop.verificationStatus !== 'APPROVED') {
        throw new BadRequestException(`Shop "${shop.name}" is not available`);
      }
      if (!shop.isOpen) throw new BadRequestException(`Shop "${shop.name}" is currently closed`);
      if (!shop.platformDeliveryEnabled) {
        throw new BadRequestException(`Shop "${shop.name}" does not support platform rider delivery`);
      }
    }

    // All shops must be in the same city
    const cities = [...new Set(shops.map((s) => s.city))];
    if (cities.length > 1) {
      throw new BadRequestException('All shops in a bulk order must be in the same city');
    }

    // Anchor shop = first shop; others must be within the city-configured radius
    const anchorShop = shops.find((s) => s.id === dto.shops[0].shopId)!;
    const proximityLimit = cityRow?.bulkShopRadiusMeters ?? MAX_BULK_SHOP_PROXIMITY_METERS;
    for (const shop of shops) {
      if (shop.id === anchorShop.id) continue;
      const dist = haversineMeters(
        { latitude: anchorShop.latitude, longitude: anchorShop.longitude },
        { latitude: shop.latitude, longitude: shop.longitude },
      );
      if (!Number.isFinite(dist) || dist > proximityLimit) {
        throw new BadRequestException(
          `Shop "${shop.name}" is ${Math.round(dist)}m from "${anchorShop.name}" — must be within ${proximityLimit}m`,
        );
      }
    }

    // All shops within delivery radius of the customer
    const deliveryRadiusMeters = cityRow?.deliveryRadiusMeters ?? 15000;
    for (const shop of shops) {
      const dist = haversineMeters(
        { latitude: shop.latitude, longitude: shop.longitude },
        dropCoords,
      );
      if (!Number.isFinite(dist) || dist > deliveryRadiusMeters) {
        throw new BadRequestException(`Shop "${shop.name}" is outside the delivery area`);
      }
    }

    // Compute base delivery fee: anchor shop → customer (distance-tiered)
    const anchorDistMeters = haversineMeters(
      { latitude: anchorShop.latitude, longitude: anchorShop.longitude },
      dropCoords,
    );
    let baseDeliveryFeePaise: number;
    if (cityRow?.deliveryTiersJson) {
      const tiers = JSON.parse(cityRow.deliveryTiersJson) as Array<{ maxKm: number; feePaise: number }>;
      const distKm = anchorDistMeters / 1000;
      const tier = tiers.find((t) => distKm <= t.maxKm) ?? tiers[tiers.length - 1];
      baseDeliveryFeePaise = tier.feePaise;
    } else {
      baseDeliveryFeePaise = platformDeliveryFeePaise(anchorDistMeters);
    }

    // Multi-shop surcharge: (N-1) × per-stop surcharge
    const perStopSurcharge = cityRow?.multiShopSurchargePaise ?? MULTI_SHOP_SURCHARGE_PAISE;
    const multiShopSurchargePaise = (dto.shops.length - 1) * perStopSurcharge;

    // Per-sub-order bills
    const productMap = new Map(products.map((p) => [p.id, p]));
    const subOrderData: Array<{
      shopId: string;
      subtotalPaise: number;
      platformFeePaise: number;
      discountPaise: number;
      items: Array<{ productId: string; name: string; pricePaise: number; qty: number; weightGrams: number | null }>;
      commissionRate: number;
      riderPickupOtp: string;
      offerId: string | null;
      offerTitle: string | null;
    }> = [];

    for (const shopCart of dto.shops) {
      const shop = shops.find((s) => s.id === shopCart.shopId)!;
      let subtotalPaise = 0;
      const items: typeof subOrderData[0]['items'] = [];

      for (const item of shopCart.items) {
        const product = productMap.get(item.productId);
        if (!product) throw new NotFoundException(`Product ${item.productId} not found`);
        if (product.shopId !== shopCart.shopId) {
          throw new BadRequestException(`Product ${item.productId} does not belong to shop ${shopCart.shopId}`);
        }
        if (!product.available) throw new BadRequestException(`"${product.name}" is not available`);
        if (product.stock < item.qty) {
          throw new BadRequestException(`Insufficient stock for "${product.name}"`);
        }
        subtotalPaise += product.pricePaise * item.qty;
        items.push({ productId: product.id, name: product.name, pricePaise: product.pricePaise, qty: item.qty, weightGrams: product.weightGrams });
      }

      const minOrder = shop.minOrderValuePaise ?? 0;
      if (subtotalPaise < minOrder) {
        throw new BadRequestException(
          `Minimum order for "${shop.name}" is ₹${minOrder / 100}`,
        );
      }

      const bill = computeBill({
        subtotalPaise,
        deliveryFeePaise: 0, // delivery is at BulkOrder level
        freeDeliveryAbovePaise: null,
        offerType: (shop.activeOffer?.type as any) ?? null,
        offerValue: shop.activeOffer?.value ?? null,
        offerMinOrderPaise: shop.activeOffer?.minOrderPaise ?? null,
      });

      subOrderData.push({
        shopId: shopCart.shopId,
        subtotalPaise,
        platformFeePaise: bill.platformFeePaise,
        discountPaise: bill.discountPaise,
        items,
        commissionRate: shop.commissionRate,
        riderPickupOtp: generateOtp(),
        offerId: shop.activeOffer?.id ?? null,
        offerTitle: shop.activeOffer?.title ?? null,
      });
    }

    // Total platform fee = sum across sub-orders
    const totalPlatformFeePaise = subOrderData.reduce((s, o) => s + o.platformFeePaise, 0);
    const totalSubtotalPaise = subOrderData.reduce((s, o) => s + o.subtotalPaise - o.discountPaise, 0);

    // Coins redemption — applied at BulkOrder level against combined subtotal
    const maxCoins = coinBalance?.coinBalance ?? 0;
    const requestedCoins = dto.redeemCoins ?? 0;
    const appliedCoins = Math.min(requestedCoins, maxCoins, Math.floor(totalSubtotalPaise / 100));
    const coinDiscountPaise = appliedCoins * 100;

    const grandTotalPaise = totalSubtotalPaise + baseDeliveryFeePaise + multiShopSurchargePaise + totalPlatformFeePaise - coinDiscountPaise;

    const bulkShortId = generateShortId('BLK');
    const customerHandoffOtp = generateOtp();

    // Atomic transaction
    // PgBouncer in transaction mode (Supabase pooler port 6543) doesn't support
    // Prisma interactive transactions. Use sequential operations with idempotency
    // protection instead — the idempotencyKey check at the top guards against duplicates.
    let bulkOrder: Awaited<ReturnType<typeof this.prisma.bulkOrder.create>>;
    try {
      bulkOrder = await this.prisma.bulkOrder.create({
        data: {
          shortId: bulkShortId,
          customerId,
          addressId: dto.addressId,
          paymentMethod: dto.paymentMethod,
          baseDeliveryFeePaise,
          multiShopSurchargePaise,
          platformFeePaise: totalPlatformFeePaise,
          totalPaise: grandTotalPaise,
          pickupOtp: customerHandoffOtp,
          idempotencyKey: dto.idempotencyKey,
        },
      });
    } catch (e: any) {
      // Unique constraint on idempotencyKey — return existing
      if (e?.code === 'P2002') {
        const existing = await this.prisma.bulkOrder.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          include: { orders: { select: { id: true, shopId: true } } },
        });
        if (existing) {
          return { bulkOrderId: existing.id, shortId: existing.shortId, orderIds: existing.orders.map(o => o.id), totalPaise: grandTotalPaise, pickupOtp: customerHandoffOtp };
        }
      }
      throw e;
    }

    // Decrement coins if used
    if (appliedCoins > 0) {
      await this.prisma.user.update({
        where: { id: customerId },
        data: { coinBalance: { decrement: appliedCoins } },
      });
    }

    // Compute coin distribution across sub-orders
    const totalSubtotalForCoins = subOrderData.reduce((s, o) => s + o.subtotalPaise, 0);
    let coinsDistributed = 0;
    const subOrderCoins = subOrderData.map((sub, idx) => {
      if (idx === subOrderData.length - 1) return coinDiscountPaise - coinsDistributed;
      const share = totalSubtotalForCoins > 0
        ? Math.floor(coinDiscountPaise * sub.subtotalPaise / totalSubtotalForCoins) : 0;
      coinsDistributed += share;
      return share;
    });

    // Create sub-orders and decrement stock in parallel across shops
    const createdOrders: Array<{ id: string; shopId: string }> = [];
    await Promise.all(subOrderData.map(async (sub, idx) => {
      const subCoins = subOrderCoins[idx];
      const subTotal = sub.subtotalPaise - sub.discountPaise + sub.platformFeePaise;
      const order = await this.prisma.order.create({
        data: {
          shortId: generateShortId('OR'),
          customerId,
          shopId: sub.shopId,
          bulkOrderId: bulkOrder.id,
          status: OrderStatus.PLACED,
          paymentMethod: dto.paymentMethod,
          deliveryMode: DeliveryMode.PLATFORM_RIDER,
          addressId: dto.addressId,
          originalTotalPaise: subTotal,
          platformFeePaise: sub.platformFeePaise,
          deliveryFeePaise: 0,
          discountPaise: sub.discountPaise,
          coinsRedeemedPaise: subCoins,
          offerId: sub.offerId,
          offerTitle: sub.offerTitle,
          commissionRateSnapshot: sub.commissionRate,
          riderPickupOtp: sub.riderPickupOtp,
          pickupOtp: customerHandoffOtp,
          idempotencyKey: `${dto.idempotencyKey}:${sub.shopId}`,
          items: {
            create: sub.items.map((item) => ({
              productId: item.productId,
              nameSnapshot: item.name,
              pricePaiseSnapshot: item.pricePaise,
              weightGramsSnapshot: item.weightGrams,
              qty: item.qty,
            })),
          },
        },
      });
      createdOrders.push({ id: order.id, shopId: sub.shopId });
      // Decrement stock in parallel
      await Promise.all(sub.items.map(item =>
        this.prisma.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.qty } },
        })
      ));
    }));

    const result = { bulkOrder, orderIds: createdOrders.map((o) => o.id), createdOrders };

    // Notify each shop (fire-and-forget)
    for (const { id: orderId, shopId } of result.createdOrders) {
      this.realtime.emitOrderCreated(shopId, { orderId });
      void this.pushToShopOwner(shopId, {
        title: 'New bulk order!',
        body: `A multi-shop order (${bulkShortId}) needs your attention.`,
        tag: `bulk-${result.bulkOrder.id}`,
        url: '/',
      });
    }

    return {
      bulkOrderId: result.bulkOrder.id,
      shortId: bulkShortId,
      orderIds: result.orderIds,
      totalPaise: grandTotalPaise,
      pickupOtp: customerHandoffOtp,
    };
  }

  /** Customer's bulk order detail. */
  async findForCustomer(customerId: string, bulkOrderId: string) {
    const bulkOrder = await this.prisma.bulkOrder.findFirst({
      where: { id: bulkOrderId, customerId, deletedAt: null },
      include: {
        orders: {
          select: {
            id: true,
            shortId: true,
            shopId: true,
            status: true,
            originalTotalPaise: true,
            platformFeePaise: true,
            discountPaise: true,
            items: { select: { id: true, nameSnapshot: true, pricePaiseSnapshot: true, qty: true } },
            shop: { select: { id: true, name: true, addressLine: true, latitude: true, longitude: true, upiVpa: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        address: { select: { line: true, landmark: true, latitude: true, longitude: true } },
        rider: {
          select: {
            id: true,
            name: true,
            phone: true,
            riderProfile: { select: { latitude: true, longitude: true } },
          },
        },
      },
    });
    if (!bulkOrder) throw new NotFoundException('Bulk order not found');

    // Compute which shop the rider is currently at/heading to (0-based index).
    // PICKING_UP = rider is collecting; index = first sub-order not yet DELIVERED/OUT_FOR_DELIVERY.
    const orders = bulkOrder.orders as Array<{ status: string }>;
    const ACTIVE = new Set(['PLACED', 'ACCEPTED', 'AWAITING_PAYMENT', 'PREPARING', 'READY', 'RIDER_ASSIGNED']);
    const currentShopIndex = orders.findIndex((o) => ACTIVE.has(o.status));

    return { ...bulkOrder, currentShopIndex: currentShopIndex === -1 ? orders.length - 1 : currentShopIndex };
  }

  /** Customer's bulk order history (keyset paginated). */
  async historyForCustomer(customerId: string, limit = 20, cursor?: string) {
    const rows = await this.prisma.bulkOrder.findMany({
      where: { customerId, deletedAt: null, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        shortId: true,
        status: true,
        totalPaise: true,
        createdAt: true,
        orders: {
          select: {
            id: true,
            shopId: true,
            shop: { select: { name: true } },
          },
        },
      },
    });
    const hasMore = rows.length > limit;
    return {
      items: rows.slice(0, limit),
      nextCursor: hasMore ? rows[limit - 1].id : null,
    };
  }

  /**
   * Called by DispatchService when all sub-orders are READY.
   * Transitions BulkOrder → READY_ALL so dispatch can fire.
   */
  async markReadyAll(bulkOrderId: string): Promise<void> {
    const bulk = await this.prisma.bulkOrder.findUnique({
      where: { id: bulkOrderId },
      select: { id: true, status: true, orders: { select: { status: true } } },
    });
    if (!bulk) return;
    const survivors = bulk.orders.filter(
      (o) => !EXITED_CHILD_STATUSES.includes(o.status as OrderStatus),
    );
    const allReady = survivors.length > 0 && survivors.every((o) => o.status === OrderStatus.READY);
    if (allReady && bulk.status === BulkOrderStatus.ACCEPTED_ALL) {
      await this.prisma.bulkOrder.update({
        where: { id: bulkOrderId },
        data: { status: BulkOrderStatus.READY_ALL },
      });
    }
  }

  /**
   * Check if all sub-orders are ACCEPTED; if so advance BulkOrder → ACCEPTED_ALL.
   * Called from OrdersService when a sub-order transitions to ACCEPTED.
   */
  async maybeAdvanceToAcceptedAll(bulkOrderId: string): Promise<void> {
    const bulk = await this.prisma.bulkOrder.findUnique({
      where: { id: bulkOrderId },
      select: { id: true, status: true, orders: { select: { status: true } } },
    });
    if (!bulk || bulk.status !== BulkOrderStatus.PLACED) return;
    const survivors = bulk.orders.filter(
      (o) => !EXITED_CHILD_STATUSES.includes(o.status as OrderStatus),
    );
    const allAccepted = survivors.length > 0 && survivors.every(
      (o) => o.status === OrderStatus.ACCEPTED ||
             o.status === OrderStatus.AWAITING_PAYMENT ||
             o.status === OrderStatus.PREPARING ||
             o.status === OrderStatus.READY,
    );
    if (allAccepted) {
      await this.prisma.bulkOrder.update({
        where: { id: bulkOrderId },
        data: { status: BulkOrderStatus.ACCEPTED_ALL },
      });
    }
  }

  /**
   * Rider calls this after confirming pickup at every shop — advances
   * BulkOrder to PICKING_UP (first shop), or OUT_FOR_DELIVERY (last shop).
   */
  async advancePickupStage(bulkOrderId: string): Promise<void> {
    const bulk = await this.prisma.bulkOrder.findUnique({
      where: { id: bulkOrderId },
      select: {
        id: true, status: true, pickupSequenceJson: true,
        orders: { select: { id: true, status: true } },
      },
    });
    if (!bulk) return;

    const seq: string[] = bulk.pickupSequenceJson ? JSON.parse(bulk.pickupSequenceJson) : [];
    const survivors = bulk.orders.filter(
      (o) => !EXITED_CHILD_STATUSES.includes(o.status as OrderStatus),
    );
    const allPickedUp = survivors.length > 0 && survivors.every((o) => o.status === OrderStatus.OUT_FOR_DELIVERY);

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

  /** Mark bulk order DELIVERED once all sub-orders are delivered. */
  async maybeMarkDelivered(bulkOrderId: string): Promise<void> {
    const bulk = await this.prisma.bulkOrder.findUnique({
      where: { id: bulkOrderId },
      select: { id: true, status: true, orders: { select: { status: true } } },
    });
    if (!bulk) return;
    const survivors = bulk.orders.filter(
      (o) => !EXITED_CHILD_STATUSES.includes(o.status as OrderStatus),
    );
    const allDelivered = survivors.length > 0 && survivors.every((o) => o.status === OrderStatus.DELIVERED);
    if (allDelivered) {
      await this.prisma.bulkOrder.update({
        where: { id: bulkOrderId },
        data: { status: BulkOrderStatus.DELIVERED },
      });
    }
  }

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
      /* best-effort */
    }
  }
}
