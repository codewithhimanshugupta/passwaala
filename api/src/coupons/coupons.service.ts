import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveAdminCity } from '../common/admin-city';

export type CouponType = 'PERCENT_OFF' | 'FLAT_OFF' | 'FREE_DELIVERY';

export interface CreateCouponDto {
  code: string;
  type: CouponType;
  value?: number;
  description?: string;
  minOrderPaise?: number;
  maxUses?: number | null;
  maxUsesPerUser?: number | null;
  validFrom?: string | null;
  expiresAt?: string | null;
  active?: boolean;
  shopIds?: string[];
}

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(adminId: string, dto: CreateCouponDto, role = 'ADMIN') {
    const code = dto.code.trim().toUpperCase();
    if (!code) throw new BadRequestException('Coupon code is required');
    const exists = await this.prisma.coupon.findFirst({ where: { code, deletedAt: null } });
    if (exists) throw new BadRequestException(`Coupon code "${code}" already exists`);

    // Auto-scope to admin's city; OWNER gets empty = global
    const adminCity = await resolveAdminCity(this.prisma, adminId, role);
    let cityIds: string[] = [];
    if (adminCity) {
      const city = await this.prisma.serviceableCity.findFirst({
        where: { name: { equals: adminCity, mode: 'insensitive' }, deletedAt: null },
        select: { id: true },
      });
      if (city) cityIds = [city.id];
    }

    return this.prisma.coupon.create({
      data: {
        code,
        type: dto.type,
        value: dto.value ?? 0,
        description: dto.description?.trim() || null,
        minOrderPaise: dto.minOrderPaise ?? 0,
        maxUses: dto.maxUses ?? null,
        maxUsesPerUser: dto.maxUsesPerUser ?? null,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        active: dto.active ?? true,
        shopIds: dto.shopIds ?? [],
        cityIds,
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
    if (dto.maxUses !== undefined) data.maxUses = dto.maxUses;
    if (dto.maxUsesPerUser !== undefined) data.maxUsesPerUser = dto.maxUsesPerUser;
    if (dto.validFrom !== undefined) data.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    if (dto.expiresAt !== undefined) data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.shopIds !== undefined) data.shopIds = dto.shopIds;
    if ((dto as { cityIds?: string[] }).cityIds !== undefined) data.cityIds = (dto as { cityIds?: string[] }).cityIds;

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

  /** Public: coupons applicable to a given shop (for customer display). */
  async listForShop(shopId: string) {
    const now = new Date();
    return this.prisma.coupon.findMany({
      where: {
        active: true, deletedAt: null,
        OR: [{ shopIds: { isEmpty: true } }, { shopIds: { has: shopId } }],
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
        ],
      },
      select: { id: true, code: true, type: true, value: true, description: true, minOrderPaise: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}
