import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryCache } from '../common/memory-cache';
import { assertOwnedByShop, requireShopScope } from '../common/shop-scope';
import { titleCaseName } from '../common/text.util';
import { CreateCategoryDto } from './dto/create-category.dto';

/**
 * CategoriesService — shop-scoped product categories (plan → Category grid /
 * drill-down). Shopkeeper CRUD is scoped to their OWN shop; the public list is
 * used by the customer category filter.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MemoryCache,
  ) {}

  /** Public: a shop's categories (for the customer drill-down). Cached 60s. */
  listForShop(shopId: string) {
    if (!shopId) {
      throw new BadRequestException('shopId is required');
    }
    return this.cache.wrap(`categories:${shopId}`, 60_000, () =>
      this.prisma.category.findMany({
        where: { shopId, deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    );
  }

  /** Shopkeeper: their OWN categories. */
  listMine(shopId: string | undefined) {
    const id = requireShopScope(shopId);
    return this.prisma.category.findMany({
      where: { shopId: id, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  /** Shopkeeper: create a category in their OWN shop. */
  async create(shopId: string | undefined, dto: CreateCategoryDto) {
    const id = requireShopScope(shopId);
    const created = await this.prisma.category.create({
      data: { shopId: id, name: titleCaseName(dto.name) },
    });
    this.cache.delete(`categories:${id}`);
    return created;
  }

  /** Shopkeeper: soft-delete a category in their OWN shop (IDOR-guarded). */
  async remove(shopId: string | undefined, categoryId: string) {
    const id = requireShopScope(shopId);
    const existing = await this.prisma.category.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { id: true, shopId: true },
    });
    assertOwnedByShop(existing, id);
    await this.prisma.category.update({
      where: { id: categoryId },
      data: { deletedAt: new Date() },
    });
    this.cache.delete(`categories:${id}`);
    return { deleted: true };
  }
}
