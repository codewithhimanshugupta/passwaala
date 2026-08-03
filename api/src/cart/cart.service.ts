import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeliveryMode, computeBill, haversineMeters, platformDeliveryFeePaise } from '@passwaala/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AddToCartDto } from './dto/add-to-cart.dto';

/**
 * CartService — the customer's single-shop cart (plan → Cart & Checkout).
 *
 * HARD RULES:
 *  - A cart maps to EXACTLY ONE shop. Adding a product from a different shop is
 *    rejected with a conflict (the app prompts "start a new cart?"). shopId is
 *    derived from the product, never trusted from the client.
 *  - The bill breakdown (subtotal + delivery + flat ₹10 platform fee) uses the
 *    shared computeBill helper — the same math the order uses.
 *  - minOrderValue is enforced on the item subtotal (surfaced live so the CTA
 *    can disable until met).
 */
@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  /** Add (or increment) a product line, enforcing the single-shop rule. */
  async addItem(customerId: string, dto: AddToCartDto) {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, deletedAt: null, available: true },
      select: { id: true, shopId: true, stock: true },
    });
    if (!product) {
      throw new NotFoundException('Product not available');
    }

    const cart = await this.prisma.cart.findFirst({
      where: { customerId, deletedAt: null },
      select: { id: true, shopId: true },
    });

    // Single-shop cart: a different shop requires clearing first.
    if (cart && cart.shopId !== product.shopId) {
      throw new ConflictException(
        'Your cart has items from another shop. Clear it to start a new cart.',
      );
    }

    const cartId =
      cart?.id ??
      (
        await this.prisma.cart.create({
          data: { customerId, shopId: product.shopId },
          select: { id: true },
        })
      ).id;

    // Upsert the line (increment qty if it already exists).
    await this.prisma.cartItem.upsert({
      where: { cartId_productId: { cartId, productId: product.id } },
      create: { cartId, productId: product.id, qty: dto.qty },
      update: { qty: { increment: dto.qty } },
    });

    // Return a LIGHT ack, not the heavy view(): the client cart is local now and
    // discards this response — computing the full bill here wasted ~6s per add.
    return { ok: true as const };
  }

  /**
   * Replace the ENTIRE cart in one call: set the shop + all lines, then return
   * the view once. This is the fast checkout path — the client used to do
   * clear + one add-per-line (each recomputing the ~6s view) + a final GET,
   * which was N+2 heavy round-trips. This is a single request + one view.
   */
  async replaceCart(
    customerId: string,
    dto: { shopId: string; items: Array<{ productId: string; qty: number }> },
    viewOpts: { deliveryMode?: DeliveryMode; addressId?: string; selectedOfferId?: string } = {},
  ) {
    const items = (dto.items ?? []).filter((i) => i.qty > 0);
    if (items.length === 0) {
      await this.clear(customerId);
      return this.view(customerId, viewOpts);
    }

    // Validate every product belongs to the given shop + is available. shopId is
    // derived from the products, never trusted blindly.
    const productIds = items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null, available: true },
      select: { id: true, shopId: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const it of items) {
      const p = byId.get(it.productId);
      if (!p) throw new NotFoundException('One or more products are unavailable');
      if (p.shopId !== dto.shopId) {
        throw new ConflictException('All items must be from the same shop.');
      }
    }

    // Atomically rebuild the cart: drop the old one, create fresh with all lines.
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.cart.findFirst({
        where: { customerId, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        await tx.cartItem.deleteMany({ where: { cartId: existing.id } });
        await tx.cart.delete({ where: { id: existing.id } });
      }
      await tx.cart.create({
        data: {
          customerId,
          shopId: dto.shopId,
          items: { create: items.map((i) => ({ productId: i.productId, qty: i.qty })) },
        },
      });
    });

    return this.view(customerId, viewOpts);
  }
  async setQty(customerId: string, productId: string, qty: number) {
    const cart = await this.prisma.cart.findFirst({
      where: { customerId, deletedAt: null },
      select: { id: true },
    });
    if (!cart) {
      throw new NotFoundException('Cart is empty');
    }
    if (qty <= 0) {
      await this.prisma.cartItem.deleteMany({
        where: { cartId: cart.id, productId },
      });
      // If that emptied the cart, delete the (now shop-bound but empty) Cart row
      // too — otherwise it keeps mapping to the old shop and blocks adding from
      // a different shop with a false "items from another shop" conflict.
      const remaining = await this.prisma.cartItem.count({ where: { cartId: cart.id } });
      if (remaining === 0) {
        await this.prisma.cart.delete({ where: { id: cart.id } });
      }
    } else {
      const line = await this.prisma.cartItem.findFirst({
        where: { cartId: cart.id, productId },
        select: { id: true },
      });
      if (!line) {
        throw new NotFoundException('Item not in cart');
      }
      await this.prisma.cartItem.update({ where: { id: line.id }, data: { qty } });
    }
    // Light ack (see addItem) — the client holds the cart locally.
    return { ok: true as const };
  }

  /** Clear the cart entirely (also used when switching shops). */
  async clear(customerId: string) {
    const cart = await this.prisma.cart.findFirst({
      where: { customerId, deletedAt: null },
      select: { id: true },
    });
    if (cart) {
      await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
      await this.prisma.cart.delete({ where: { id: cart.id } });
    }
    return { cleared: true };
  }

  /**
   * The full cart view: line items (with current price snapshots), the bill
   * breakdown, and min-order-value status so the app can gate checkout.
   *
   * `opts.deliveryMode` + `opts.addressId` let the checkout preview the exact
   * fee the server will charge: for PLATFORM_RIDER we compute the distance-tiered
   * fee (shop→drop); otherwise the shop's flat fee is shown. Both optional — a
   * bare GET /cart still previews the flat fee.
   */
  async view(
    customerId: string,
    opts: { deliveryMode?: DeliveryMode; addressId?: string; selectedOfferId?: string } = {},
  ) {
    const cart = await this.prisma.cart.findFirst({
      where: { customerId, deletedAt: null },
      include: {
        shop: {
          select: {
            id: true,
            name: true,
            deliveryFeePaise: true,
            freeDeliveryAbovePaise: true,
            minOrderValuePaise: true,
            isOpen: true,
            latitude: true,
            longitude: true,
            platformDeliveryEnabled: true,
            selfPickupEnabled: true,
            city: true,
            activeOffer: {
              select: { id: true, title: true, type: true, value: true, minOrderPaise: true, active: true },
            },
          },
        },
        items: {
          include: {
            product: {
              select: { id: true, name: true, pricePaise: true, available: true, stock: true },
            },
          },
        },
      },
    });

    if (!cart) {
      return { empty: true as const, items: [] as never[] };
    }

    const lines = cart.items.map((it) => ({
      productId: it.productId,
      name: it.product.name,
      unitPricePaise: it.product.pricePaise,
      qty: it.qty,
      lineTotalPaise: it.product.pricePaise * it.qty,
      available: it.product.available && it.product.stock > 0,
    }));

    const subtotalPaise = lines.reduce((sum, l) => sum + l.lineTotalPaise, 0);

    // Preview the same fee the server will charge (see place() in orders.service).
    let deliveryFeePaise = cart.shop.deliveryFeePaise;
    let freeDeliveryAbovePaise: number | null | undefined = cart.shop.freeDeliveryAbovePaise;
    if (opts.deliveryMode === DeliveryMode.SELF_PICKUP) {
      deliveryFeePaise = 0;
      freeDeliveryAbovePaise = null;
    } else if (opts.deliveryMode === DeliveryMode.PLATFORM_RIDER) {
      let dropCoords: { latitude: unknown; longitude: unknown } | null = null;
      if (opts.addressId) {
        const address = await this.prisma.address.findFirst({
          where: { id: opts.addressId, userId: customerId, deletedAt: null },
          select: { latitude: true, longitude: true },
        });
        if (address) dropCoords = { latitude: address.latitude, longitude: address.longitude };
      }
      const distanceMeters = haversineMeters(
        { latitude: cart.shop.latitude, longitude: cart.shop.longitude },
        dropCoords ?? { latitude: null, longitude: null },
      );
      const cityForFee = cart.shop.city;
      const cityTierConfig = cityForFee
        ? await this.prisma.serviceableCity.findFirst({
            where: {
              deletedAt: null,
              OR: [
                { name: { equals: cityForFee, mode: 'insensitive' } },
                // shop city is "Chirgaon, Jhansi" → check if any city name appears in it
                { name: { in: cityForFee.split(',').map(p => p.trim()) } },
              ],
            },
            select: { deliveryTiersJson: true },
          })
        : null;
      if (!cityTierConfig?.deliveryTiersJson) {
        throw new BadRequestException('Platform delivery is not configured for this city yet. Please contact support.');
      }
      const tiers: Array<{ maxKm: number; feePaise: number }> = JSON.parse(cityTierConfig.deliveryTiersJson);
      if (!tiers.length) {
        throw new BadRequestException('Delivery fee tiers are not configured for this city.');
      }
      const distKm = distanceMeters / 1000;
      const tier = tiers.find(t => distKm <= t.maxKm) ?? tiers[tiers.length - 1];
      deliveryFeePaise = tier.feePaise;
      freeDeliveryAbovePaise = null;
    }

    // Check if any rider is online near the shop (for platform delivery)
    // Only runs when city has requireRiderForDelivery = true
    let riderAvailable = true;
    if (opts.deliveryMode === DeliveryMode.PLATFORM_RIDER) {
      const shopLat = cart.shop.latitude ? Number(cart.shop.latitude) : null;
      const shopLng = cart.shop.longitude ? Number(cart.shop.longitude) : null;
      // Check city config
      const cityConfig = cart.shop.city
        ? await this.prisma.serviceableCity.findFirst({
            where: {
              deletedAt: null,
              OR: [
                { name: { equals: cart.shop.city, mode: 'insensitive' } },
                { name: { contains: cart.shop.city.split(',')[0].trim(), mode: 'insensitive' } },
              ],
            },
            select: { deliveryRadiusMeters: true, riderCheckRadiusMeters: true },
          })
        : null;
      // Always check for online rider — this is not configurable
      if (shopLat && shopLng) {
        const radius = (cityConfig as { riderCheckRadiusMeters?: number } | null)?.riderCheckRadiusMeters ?? 5000;
        const nearbyRiders = await this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) as count FROM "RiderProfile" rp
          WHERE rp.online = true
          AND rp.geog IS NOT NULL
          AND ST_DWithin(
            rp.geog,
            ST_SetSRID(ST_MakePoint(${shopLng}, ${shopLat}), 4326)::geography,
            ${radius}
          )
        `.catch(() => [{ count: BigInt(0) }]);
        riderAvailable = Number(nearbyRiders[0]?.count ?? 0) > 0;
      }
    }

    // Fetch available offers: city offer templates + admin coupons active for this shop
    const cityOffers = cart.shop.city
      ? await this.prisma.offerTemplate.findMany({
          where: { city: { name: { equals: cart.shop.city, mode: 'insensitive' } }, active: true, deletedAt: null },
          select: { id: true, title: true, type: true, value: true, minOrderPaise: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const shopCoupons = await this.prisma.coupon.findMany({
      where: { shopIds: { has: cart.shop.id }, active: true, deletedAt: null },
      select: { id: true, code: true, description: true, type: true, value: true, minOrderPaise: true },
    });
    const couponOffers = shopCoupons.map(c => ({
      id: c.id,
      title: c.code + (c.description ? ` — ${c.description}` : ''),
      type: c.type,
      value: c.value,
      minOrderPaise: c.minOrderPaise,
    }));
    const allOffers = [...cityOffers, ...couponOffers];

    // Customer-selected offer: validate against allOffers list
    const shopActiveOffer = cart.shop.activeOffer?.active ? cart.shop.activeOffer : null;
    const offer = opts.selectedOfferId
      ? (allOffers.find(o => o.id === opts.selectedOfferId) ?? null)
      : shopActiveOffer;
    const bill = computeBill({
      subtotalPaise,
      deliveryFeePaise,
      freeDeliveryAbovePaise,
      offerType: offer?.type as import('@passwaala/shared').OfferType | null ?? null,
      offerValue: offer?.value ?? null,
      offerMinOrderPaise: offer?.minOrderPaise ?? null,
    });

    const minOrderValuePaise = cart.shop.minOrderValuePaise;
    const meetsMinOrder = subtotalPaise >= minOrderValuePaise;

    return {
      empty: false as const,
      shop: { id: cart.shop.id, name: cart.shop.name, isOpen: cart.shop.isOpen, selfPickupEnabled: (cart.shop as { selfPickupEnabled?: boolean | null }).selfPickupEnabled !== false },
      items: lines,
      bill,
      activeOffer: offer ? { id: offer.id, title: offer.title, type: offer.type, value: offer.value, minOrderPaise: offer.minOrderPaise } : null,
      availableOffers: allOffers,
      minOrderValuePaise,
      meetsMinOrder,
      amountToMinOrderPaise: meetsMinOrder ? 0 : minOrderValuePaise - subtotalPaise,
      riderAvailable,
    };
  }
}
