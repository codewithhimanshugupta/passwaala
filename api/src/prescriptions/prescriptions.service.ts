import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CreatePrescription,
  QuotePrescription,
  RejectPrescription,
  PrescriptionStatus,
  PrescriptionView,
  OrderStatus,
  PaymentMethod,
  DeliveryMode,
  VerificationStatus,
  MEDICAL_CATEGORY,
  computeGst,
  haversineMeters,
  platformDeliveryFeePaise,
} from '@passwaala/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { WebPushService } from '../notifications/web-push.service';
import { requireShopScope, assertOwnedByShop } from '../common/shop-scope';

/**
 * PrescriptionsService — the medical-store-only order flow.
 *
 * A customer uploads a prescription image to a MEDICAL shop (no product picking).
 * The shop reads it and builds a free-text itemized quote, which becomes an Order
 * the customer pays for ONLINE (UPI_DIRECT — no COD), then flows through the normal
 * delivery pipeline. Mirrors the postpaid/idempotent conventions of OrdersService.
 *
 * The created Order carries free-text OrderItems (productId = null; name/price
 * snapshots hold the display data) and is created directly at AWAITING_PAYMENT
 * (the shop has effectively accepted by quoting), forcing UPI_DIRECT.
 */
@Injectable()
export class PrescriptionsService {
  /** Default platform fee (paise) when the city has no override — mirrors orders. */
  private static readonly DEFAULT_PLATFORM_FEE_PAISE = 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly webPush: WebPushService,
  ) {}

  private async pushToShopOwner(
    shopId: string,
    payload: { title: string; body: string; tag?: string; url?: string },
  ): Promise<void> {
    try {
      const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { ownerId: true } });
      if (shop?.ownerId) await this.webPush.sendToUser(shop.ownerId, payload);
    } catch {
      /* best-effort — never block the flow on a push */
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Customer: upload a prescription
  // ───────────────────────────────────────────────────────────────────────────

  async create(customerId: string, dto: CreatePrescription): Promise<PrescriptionView> {
    if (!dto.imageUrls || dto.imageUrls.length === 0) {
      throw new BadRequestException('At least one prescription image is required');
    }
    const shop = await this.prisma.shop.findFirst({
      where: { id: dto.shopId, deletedAt: null },
      select: { id: true, name: true, shopCategory: true, verificationStatus: true },
    });
    if (!shop || shop.verificationStatus !== VerificationStatus.APPROVED) {
      throw new BadRequestException('Shop not found');
    }
    // Only medical (pharmacy) shops accept the prescription flow.
    if ((shop.shopCategory ?? '').toLowerCase() !== MEDICAL_CATEGORY) {
      throw new BadRequestException('This shop does not accept prescription orders');
    }

    // Resolve the delivery choice now (the shop, not the customer, triggers the
    // quote that creates the Order later, so it must be persisted here).
    const deliveryMode = dto.deliveryMode ?? DeliveryMode.SELF_PICKUP;
    let addressId: string | null = null;
    if (deliveryMode !== DeliveryMode.SELF_PICKUP) {
      if (!dto.addressId) throw new BadRequestException('A delivery address is required');
      const address = await this.prisma.address.findFirst({
        where: { id: dto.addressId, userId: customerId, deletedAt: null },
        select: { id: true },
      });
      if (!address) throw new NotFoundException('Address not found');
      addressId = address.id;
    }

    const id = randomUUID();
    const shortId = `RX${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const created = await this.prisma.prescription.create({
      data: {
        id,
        shortId,
        customerId,
        shopId: dto.shopId,
        imageUrls: dto.imageUrls,
        note: dto.note,
        deliveryMode,
        addressId,
        status: PrescriptionStatus.SUBMITTED,
      },
      include: { shop: { select: { name: true } } },
    });

    this.realtime.emitPrescriptionCreated(dto.shopId, { prescriptionId: id });
    void this.pushToShopOwner(dto.shopId, {
      title: '💊 New prescription',
      body: 'A customer sent a prescription — tap to build their bill.',
      tag: `rx-${id}`,
      url: '/',
    });

    return this.toView(created);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Lists / detail
  // ───────────────────────────────────────────────────────────────────────────

  /** Customer: their own prescriptions (newest first). */
  async myPrescriptions(customerId: string): Promise<PrescriptionView[]> {
    const rows = await this.prisma.prescription.findMany({
      where: { customerId, deletedAt: null },
      include: { shop: { select: { name: true } }, order: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => this.toView(r));
  }

  /** Shop: its prescription queue (pending first, then newest). Shop-scoped. */
  async shopPrescriptions(shopId: string | undefined): Promise<PrescriptionView[]> {
    const id = requireShopScope(shopId);
    const rows = await this.prisma.prescription.findMany({
      where: { shopId: id, deletedAt: null },
      include: { shop: { select: { name: true } }, order: { select: { id: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return rows.map((r) => this.toView(r));
  }

  /** Fetch one prescription, authorizing the caller as its customer OR its shop. */
  async getOne(
    prescriptionId: string,
    ctx: { customerId?: string; shopId?: string },
  ): Promise<PrescriptionView> {
    const rx = await this.prisma.prescription.findFirst({
      where: { id: prescriptionId, deletedAt: null },
      include: { shop: { select: { name: true } }, order: { select: { id: true } } },
    });
    if (!rx) throw new NotFoundException('Prescription not found');
    const isOwnerCustomer = ctx.customerId && rx.customerId === ctx.customerId;
    const isOwnerShop = ctx.shopId && rx.shopId === ctx.shopId;
    if (!isOwnerCustomer && !isOwnerShop) throw new NotFoundException('Prescription not found');
    return this.toView(rx);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Shop: quote (build the bill → Order) or reject
  // ───────────────────────────────────────────────────────────────────────────

  async quote(
    shopId: string | undefined,
    prescriptionId: string,
    dto: QuotePrescription,
  ): Promise<PrescriptionView> {
    const sid = requireShopScope(shopId);
    if (!dto.idempotencyKey) throw new BadRequestException('idempotencyKey is required');
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Add at least one line item');
    }
    // Validate line items (integer paise, positive qty; names non-empty).
    for (const it of dto.items) {
      if (!it.name || !it.name.trim()) throw new BadRequestException('Each item needs a name');
      if (!Number.isInteger(it.pricePaise) || it.pricePaise < 0) {
        throw new BadRequestException('Item price must be a non-negative integer (paise)');
      }
      if (!Number.isInteger(it.quantity) || it.quantity < 1) {
        throw new BadRequestException('Item quantity must be at least 1');
      }
    }

    // Idempotency: a repeated key returns the already-created order's prescription.
    const priorOrder = await this.prisma.order.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      select: { id: true, prescriptionId: true, shopId: true },
    });
    if (priorOrder) {
      if (priorOrder.shopId !== sid) throw new ForbiddenException('Idempotency key belongs to another shop');
      if (priorOrder.prescriptionId) return this.getOne(priorOrder.prescriptionId, { shopId: sid });
    }

    const rx = await this.prisma.prescription.findFirst({
      where: { id: prescriptionId, deletedAt: null },
      include: {
        shop: {
          select: {
            id: true,
            city: true,
            commissionRate: true,
            deliveryFeePaise: true,
            freeDeliveryAbovePaise: true,
            latitude: true,
            longitude: true,
            platformDeliveryEnabled: true,
            isOpen: true,
            verificationStatus: true,
          },
        },
        address: { select: { latitude: true, longitude: true } },
        order: { select: { id: true } },
      },
    });
    if (!rx) throw new NotFoundException('Prescription not found');
    assertOwnedByShop({ id: rx.id, shopId: rx.shopId }, sid);
    if (rx.status === PrescriptionStatus.QUOTED || rx.order) {
      // Already quoted — return current state rather than double-creating.
      return this.getOne(rx.id, { shopId: sid });
    }
    if (rx.status === PrescriptionStatus.REJECTED) {
      throw new BadRequestException('This prescription was rejected');
    }
    if (rx.shop.verificationStatus !== VerificationStatus.APPROVED) {
      throw new BadRequestException('Shop is not available');
    }

    // Totals (integer paise). Delivery is auto-priced by distance (like normal
    // platform-rider orders) — the shop no longer sets it manually.
    const subtotalPaise = dto.items.reduce((s, it) => s + it.pricePaise * it.quantity, 0);
    const isPickup = rx.deliveryMode === DeliveryMode.SELF_PICKUP;

    // Delivery mode for the order: pickup stays pickup; a delivery follows the
    // shop's platform-delivery setting (rider vs self-deliver) like normal orders.
    const orderDeliveryMode = isPickup
      ? DeliveryMode.SELF_PICKUP
      : rx.shop.platformDeliveryEnabled
        ? DeliveryMode.PLATFORM_RIDER
        : DeliveryMode.SELF_DELIVERY;

    const cityCfg = rx.shop.city
      ? await this.prisma.serviceableCity.findFirst({
          where: { name: { equals: rx.shop.city, mode: 'insensitive' }, deletedAt: null },
          select: { platformFeePaise: true, deliveryTiersJson: true },
        })
      : null;

    // Delivery fee by mode (mirror orders.service):
    //  - SELF_PICKUP    → ₹0.
    //  - PLATFORM_RIDER → distance-tiered (shop→drop), auto-computed.
    //  - SELF_DELIVERY  → the shop's own flat fee.
    let deliveryFeePaise: number;
    if (orderDeliveryMode === DeliveryMode.SELF_PICKUP) {
      deliveryFeePaise = 0;
    } else if (orderDeliveryMode === DeliveryMode.PLATFORM_RIDER) {
      const distanceMeters = haversineMeters(
        { latitude: rx.shop.latitude, longitude: rx.shop.longitude },
        rx.address ?? { latitude: null, longitude: null },
      );
      if (cityCfg?.deliveryTiersJson) {
        const tiers: Array<{ maxKm: number; feePaise: number }> = JSON.parse(cityCfg.deliveryTiersJson);
        const distKm = distanceMeters / 1000;
        const tier = tiers.find((t) => distKm <= t.maxKm) ?? tiers[tiers.length - 1];
        deliveryFeePaise = tier.feePaise;
      } else {
        deliveryFeePaise = platformDeliveryFeePaise(distanceMeters);
      }
    } else {
      deliveryFeePaise = rx.shop.deliveryFeePaise;
    }

    // Platform fee: ₹10 base + 18% GST = ₹11.80 (GST-inclusive), same as normal
    // orders (computeBill). The customer bears the GST; it's shown as its own line.
    const platformFeeBasePaise = cityCfg?.platformFeePaise ?? PrescriptionsService.DEFAULT_PLATFORM_FEE_PAISE;
    const platformFeePaise = computeGst(platformFeeBasePaise).totalPaise;
    const totalPaise = subtotalPaise + deliveryFeePaise + platformFeePaise;

    const pickupOtp = Math.floor(1000 + Math.random() * 9000).toString();
    const riderPickupOtp = Math.floor(1000 + Math.random() * 9000).toString();
    const orderId = randomUUID();
    const orderShortId = `OR${orderId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    await this.prisma.$transaction([
      this.prisma.order.create({
        data: {
          id: orderId,
          shortId: orderShortId,
          customerId: rx.customerId,
          shopId: sid,
          status: OrderStatus.AWAITING_PAYMENT, // shop quoted → customer must pay (UPI only)
          paymentMethod: PaymentMethod.UPI_DIRECT,
          deliveryMode: orderDeliveryMode,
          addressId: isPickup ? null : rx.addressId,
          pickupOtp,
          riderPickupOtp,
          originalTotalPaise: totalPaise,
          platformFeePaise,
          deliveryFeePaise,
          commissionRateSnapshot: rx.shop.commissionRate,
          idempotencyKey: dto.idempotencyKey,
          prescriptionId: rx.id,
          items: {
            create: dto.items.map((it) => ({
              productId: null,
              nameSnapshot: it.name.trim(),
              pricePaiseSnapshot: it.pricePaise,
              qty: it.quantity,
            })),
          },
        },
      }),
      this.prisma.prescription.update({
        where: { id: rx.id },
        data: { status: PrescriptionStatus.QUOTED },
      }),
    ]);

    this.realtime.emitPrescriptionUpdated(rx.customerId, {
      prescriptionId: rx.id,
      status: PrescriptionStatus.QUOTED,
      orderId,
    });
    // Surface the freshly-created order in the shop's Orders tab live (a silent
    // refresh — no new-order alarm, since the shop itself just created it).
    this.realtime.emitOrderShopUpdate(sid, { orderId, status: OrderStatus.AWAITING_PAYMENT });
    void this.pushToUser(rx.customerId, {
      title: '🧾 Your prescription bill is ready',
      body: `Total ₹${(totalPaise / 100).toFixed(2)} — review and pay to confirm.`,
      tag: `rx-${rx.id}`,
      url: '/',
    });

    return this.getOne(rx.id, { shopId: sid });
  }

  async reject(
    shopId: string | undefined,
    prescriptionId: string,
    dto: RejectPrescription,
  ): Promise<PrescriptionView> {
    const sid = requireShopScope(shopId);
    const rx = await this.prisma.prescription.findFirst({
      where: { id: prescriptionId, deletedAt: null },
      select: { id: true, shopId: true, status: true, customerId: true },
    });
    if (!rx) throw new NotFoundException('Prescription not found');
    assertOwnedByShop({ id: rx.id, shopId: rx.shopId }, sid);
    if (rx.status === PrescriptionStatus.QUOTED) {
      throw new BadRequestException('Already quoted — cannot reject');
    }
    const updated = await this.prisma.prescription.update({
      where: { id: rx.id },
      data: { status: PrescriptionStatus.REJECTED, rejectionReason: dto.reason?.trim() || 'Unable to fulfil' },
      include: { shop: { select: { name: true } }, order: { select: { id: true } } },
    });
    this.realtime.emitPrescriptionUpdated(rx.customerId, {
      prescriptionId: rx.id,
      status: PrescriptionStatus.REJECTED,
    });
    void this.pushToUser(rx.customerId, {
      title: 'Prescription update',
      body: `The pharmacy could not fulfil your prescription: ${updated.rejectionReason}`,
      tag: `rx-${rx.id}`,
      url: '/',
    });
    return this.toView(updated);
  }

  private async pushToUser(
    userId: string,
    payload: { title: string; body: string; tag?: string; url?: string },
  ): Promise<void> {
    try {
      await this.webPush.sendToUser(userId, payload);
    } catch {
      /* best-effort */
    }
  }

  private toView(rx: {
    id: string;
    shortId: string | null;
    status: string;
    customerId: string;
    shopId: string;
    imageUrls: string[];
    note: string | null;
    rejectionReason: string | null;
    createdAt: Date;
    updatedAt: Date;
    shop: { name: string };
    order?: { id: string } | null;
  }): PrescriptionView {
    return {
      id: rx.id,
      shortId: rx.shortId,
      status: rx.status as PrescriptionStatus,
      customerId: rx.customerId,
      shopId: rx.shopId,
      shopName: rx.shop.name,
      imageUrls: rx.imageUrls,
      note: rx.note,
      rejectionReason: rx.rejectionReason,
      orderId: rx.order?.id ?? null,
      createdAt: rx.createdAt.toISOString(),
      updatedAt: rx.updatedAt.toISOString(),
    };
  }
}
