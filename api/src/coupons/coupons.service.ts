import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveAdminCity } from '../common/admin-city';

export type CouponType = 'PERCENT_OFF' | 'FLAT_OFF' | 'FREE_DELIVERY';
export type CouponFundedBy = 'SHOP' | 'NEARBAZ';

export interface CreateCouponDto {
  code: string;
  type: CouponType;
  value?: number;
  description?: string;
  minOrderPaise?: number;
  maxDiscountPaise?: number | null;
  maxUses?: number | null;
  maxUsesPerUser?: number | null;
  validFrom?: string | null;
  expiresAt?: string | null;
  active?: boolean;
  shopIds?: string[];
  /** Explicit city targeting (ids). Required for NEARBAZ-funded coupons. */
  cityIds?: string[];
  /** SHOP (default, shop absorbs) or NEARBAZ (platform-funded). */
  fundedBy?: CouponFundedBy;
}

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(adminId: string, dto: CreateCouponDto, role = 'ADMIN') {
    const code = dto.code.trim().toUpperCase();
    if (!code) throw new BadRequestException('Coupon code is required');
    const exists = await this.prisma.coupon.findFirst({ where: { code, deletedAt: null } });
    if (exists) throw new BadRequestException(`Coupon code "${code}" already exists`);

    const fundedBy: CouponFundedBy = dto.fundedBy === 'NEARBAZ' ? 'NEARBAZ' : 'SHOP';

    // City targeting. NEARBAZ-funded coupons are assigned DIRECTLY to cities with
    // no shop involvement — an explicit city selection is required. SHOP coupons
    // keep the legacy behaviour: honour an explicit selection, else auto-scope to
    // the admin's city (OWNER with no selection = global).
    let cityIds: string[] = Array.isArray(dto.cityIds) ? dto.cityIds.filter(Boolean) : [];
    if (fundedBy === 'NEARBAZ') {
      if (cityIds.length === 0) {
        throw new BadRequestException('Select at least one city for a NearBaz-funded coupon');
      }
    } else if (cityIds.length === 0) {
      const adminCity = await resolveAdminCity(this.prisma, adminId, role);
      if (adminCity) {
        const city = await this.prisma.serviceableCity.findFirst({
          where: { name: { equals: adminCity, mode: 'insensitive' }, deletedAt: null },
          select: { id: true },
        });
        if (city) cityIds = [city.id];
      }
    }

    // A NearBaz-funded coupon has NO shop involvement — never scope it to shops.
    const shopIds = fundedBy === 'NEARBAZ' ? [] : (dto.shopIds ?? []);

    return this.prisma.coupon.create({
      data: {
        code,
        type: dto.type,
        value: dto.value ?? 0,
        description: dto.description?.trim() || null,
        minOrderPaise: dto.minOrderPaise ?? 0,
        maxDiscountPaise: dto.maxDiscountPaise ?? null,
        maxUses: dto.maxUses ?? null,
        maxUsesPerUser: dto.maxUsesPerUser ?? null,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        active: dto.active ?? true,
        shopIds,
        cityIds,
        fundedBy,
        createdById: adminId,
      },
    });
  }

  async list(adminId: string, role: string, includeInactive = false) {
    // OWNER sees all; ADMIN sees only their city's coupons
    let cityFilter: { cityIds?: { has: string } } = {};
    if (role !== 'OWNER') {
      const adminCity = await resolveAdminCity(this.prisma, adminId, role);
      if (adminCity) {
        const city = await this.prisma.serviceableCity.findFirst({
          where: { name: { equals: adminCity, mode: 'insensitive' }, deletedAt: null },
          select: { id: true },
        });
        if (city) cityFilter = { cityIds: { has: city.id } };
      }
    }
    return this.prisma.coupon.findMany({
      where: { deletedAt: null, ...(includeInactive ? {} : { active: true }), ...cityFilter },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { usages: true } } },
    });
  }

  async update(id: string, dto: Partial<CreateCouponDto>) {
    const coupon = await this.prisma.coupon.findFirst({ where: { id, deletedAt: null } });
    if (!coupon) throw new NotFoundException('Coupon not found');

    const data: Record<string, unknown> = {};
    if (dto.code !== undefined) data.code = dto.code.trim().toUpperCase();
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.value !== undefined) data.value = dto.value;
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.minOrderPaise !== undefined) data.minOrderPaise = dto.minOrderPaise;
    if (dto.maxDiscountPaise !== undefined) data.maxDiscountPaise = dto.maxDiscountPaise;
    if (dto.maxUses !== undefined) data.maxUses = dto.maxUses;
    if (dto.maxUsesPerUser !== undefined) data.maxUsesPerUser = dto.maxUsesPerUser;
    if (dto.validFrom !== undefined) data.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    if (dto.expiresAt !== undefined) data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.shopIds !== undefined) data.shopIds = dto.shopIds;
    if ((dto as { cityIds?: string[] }).cityIds !== undefined) data.cityIds = (dto as { cityIds?: string[] }).cityIds;
    if (dto.fundedBy !== undefined) data.fundedBy = dto.fundedBy === 'NEARBAZ' ? 'NEARBAZ' : 'SHOP';

    return this.prisma.coupon.update({ where: { id }, data });
  }

  async remove(id: string) {
    const coupon = await this.prisma.coupon.findFirst({ where: { id, deletedAt: null } });
    if (!coupon) throw new NotFoundException('Coupon not found');
    return this.prisma.coupon.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
  }

  /** Validate a coupon code at checkout — returns the coupon or throws. */
  async validate(code: string, userId: string, shopId: string, subtotalPaise: number) {
    const now = new Date();
    const coupon = await this.prisma.coupon.findFirst({
      where: { code: code.trim().toUpperCase(), active: true, deletedAt: null },
    });
    if (!coupon) throw new BadRequestException('Invalid coupon code');
    if (coupon.validFrom && coupon.validFrom > now) throw new BadRequestException('Coupon is not valid yet');
    if (coupon.expiresAt && coupon.expiresAt < now) throw new BadRequestException('Coupon has expired');
    if (coupon.minOrderPaise > 0 && subtotalPaise < coupon.minOrderPaise) {
      throw new BadRequestException(`Add ${(coupon.minOrderPaise - subtotalPaise) / 100} more to use this coupon`);
    }
    if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
      throw new BadRequestException('This coupon has reached its usage limit');
    }
    if (coupon.shopIds.length > 0 && !coupon.shopIds.includes(shopId)) {
      throw new BadRequestException('This coupon is not valid for this shop');
    }
    // City targeting: when the coupon is scoped to specific cities, the shop's
    // city must be one of them. This is the ONLY shop gate for a NearBaz-funded
    // coupon (which has no shopIds) — it is valid city-wide for every shop.
    if (coupon.cityIds.length > 0) {
      const cityId = await this.resolveShopCityId(shopId);
      if (!cityId || !coupon.cityIds.includes(cityId)) {
        throw new BadRequestException('This coupon is not valid in this city');
      }
    }
    if (coupon.maxUsesPerUser != null) {
      const userCount = await this.prisma.couponUsage.count({ where: { couponId: coupon.id, userId } });
      if (userCount >= coupon.maxUsesPerUser) {
        throw new BadRequestException('You have already used this coupon the maximum number of times');
      }
    }
    return coupon;
  }

  /** Record usage after a successful order. */
  async recordUsage(couponId: string, userId: string, orderId: string) {
    await this.prisma.$transaction([
      this.prisma.couponUsage.create({ data: { couponId, userId, orderId } }),
      this.prisma.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } }),
    ]);
  }

  /**
   * Resolve a shop's ServiceableCity id from its (denormalised) city name.
   * Returns null when the shop's city isn't a serviceable city. Used to gate
   * city-targeted coupons (incl. all NearBaz-funded ones).
   */
  async resolveShopCityId(shopId: string): Promise<string | null> {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { city: true } });
    if (!shop?.city) return null;
    const city = await this.prisma.serviceableCity.findFirst({
      where: { name: { equals: shop.city, mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });
    return city?.id ?? null;
  }

  /**
   * Pure discount maths for a coupon against an item subtotal (all integer
   * paise, rule #4). Mirrors the offer maths in computeBill so a coupon and an
   * offer behave identically. Returns the item discount + whether the coupon
   * waives delivery (FREE_DELIVERY). The min-order gate is validated separately
   * in validate(); this assumes the coupon already qualifies.
   */
  computeCouponDiscount(
    coupon: { type: string; value: number; maxDiscountPaise: number | null },
    subtotalPaise: number,
  ): { itemDiscountPaise: number; freeDelivery: boolean } {
    if (coupon.type === 'FREE_DELIVERY') {
      return { itemDiscountPaise: 0, freeDelivery: true };
    }
    if (coupon.type === 'PERCENT_OFF') {
      let d = Math.floor((subtotalPaise * coupon.value) / 100);
      if (coupon.maxDiscountPaise != null && coupon.maxDiscountPaise > 0) {
        d = Math.min(d, coupon.maxDiscountPaise);
      }
      return { itemDiscountPaise: Math.max(0, d), freeDelivery: false };
    }
    // FLAT_OFF
    return { itemDiscountPaise: Math.max(0, Math.min(coupon.value, subtotalPaise)), freeDelivery: false };
  }

  /** Public: coupons applicable to a given shop (for customer display). */
  async listForShop(shopId: string) {
    const now = new Date();
    // Resolve the shop's city so city-targeted coupons (incl. NearBaz-funded)
    // only surface where they apply. A coupon shows when its cityIds is empty
    // (all cities) OR contains the shop's city.
    const cityId = await this.resolveShopCityId(shopId);
    return this.prisma.coupon.findMany({
      where: {
        active: true, deletedAt: null,
        OR: [{ shopIds: { isEmpty: true } }, { shopIds: { has: shopId } }],
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
          { OR: [{ cityIds: { isEmpty: true } }, ...(cityId ? [{ cityIds: { has: cityId } }] : [])] },
        ],
      },
      select: { id: true, code: true, type: true, value: true, description: true, minOrderPaise: true, maxDiscountPaise: true, expiresAt: true, fundedBy: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  /**
   * Admin: serviceable cities (id + name) for the coupon city multiselect.
   * ADMIN/OWNER only (wired on the admin coupons controller).
   */
  async listCities() {
    return this.prisma.serviceableCity.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, enabled: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Admin: total NearBaz-funded coupon spend (the platform's marketing cost) from
   * the PlatformLedgerEntry ledger, plus a per-coupon breakdown. This is NearBaz's
   * OWN accounting — never a shop's dues. OWNER sees all; a city ADMIN sees only
   * entries for their city.
   */
  async platformCouponSpend(adminId: string, role: string) {
    let cityIds: string[] | null = null;
    if (role !== 'OWNER') {
      const adminCity = await resolveAdminCity(this.prisma, adminId, role);
      if (adminCity) {
        const city = await this.prisma.serviceableCity.findFirst({
          where: { name: { equals: adminCity, mode: 'insensitive' }, deletedAt: null },
          select: { id: true },
        });
        cityIds = city ? [city.id] : ['__none__'];
      } else {
        cityIds = ['__none__'];
      }
    }
    const where = {
      type: 'COUPON_SUBSIDY',
      deletedAt: null,
      ...(cityIds ? { cityId: { in: cityIds } } : {}),
    };
    const [agg, rows] = await Promise.all([
      this.prisma.platformLedgerEntry.aggregate({ where, _sum: { amountPaise: true }, _count: true }),
      this.prisma.platformLedgerEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, couponCode: true, amountPaise: true, orderId: true, cityId: true, createdAt: true },
      }),
    ]);
    return {
      totalSpendPaise: agg._sum.amountPaise ?? 0,
      redemptions: agg._count,
      entries: rows,
    };
  }
}
