import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBannerDto, UpdateBannerDto } from './dto/banner.dto';

/**
 * BannersService — admin-managed home banner carousel images shown to customers.
 *
 * Targeting: `Banner.cities` holds canonical city names (matching
 * ServiceableCity.name / Shop.city). An EMPTY array means the banner shows in
 * ALL cities. The customer's detected city string ("Jhansi, UP") is matched
 * fuzzily (case-insensitive substring, both directions) against those names —
 * mirroring the serviceable-city matching the customer app already does.
 */
@Injectable()
export class BannersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public: active banners for a customer's city, in display order. */
  async activeForCity(city?: string): Promise<{ id: string; imageUrl: string; sortOrder: number }[]> {
    const banners = await this.prisma.banner.findMany({
      where: { active: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    const c = (city ?? '').trim().toLowerCase();
    return banners
      .filter((b) => {
        if (!b.cities || b.cities.length === 0) return true; // global banner
        if (!c) return false; // targeted banner but the customer's city is unknown
        return b.cities.some((name) => {
          const n = name.trim().toLowerCase();
          return n.length > 0 && (c.includes(n) || n.includes(c));
        });
      })
      .map((b) => ({ id: b.id, imageUrl: b.imageUrl, sortOrder: b.sortOrder }));
  }

  /** Admin: all banners (active-only unless showAll), in display order. */
  adminList(showAll: boolean) {
    return this.prisma.banner.findMany({
      where: { deletedAt: null, ...(showAll ? {} : { active: true }) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  adminCreate(dto: CreateBannerDto) {
    return this.prisma.banner.create({
      data: {
        imageUrl: dto.imageUrl,
        cities: dto.cities ?? [],
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active ?? true,
      },
    });
  }

  adminUpdate(id: string, dto: UpdateBannerDto) {
    return this.prisma.banner.update({
      where: { id },
      data: {
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
        ...(dto.cities !== undefined ? { cities: dto.cities } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }

  /** Soft-delete (kept out of every query via deletedAt). */
  async adminDelete(id: string): Promise<{ ok: true }> {
    await this.prisma.banner.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}
