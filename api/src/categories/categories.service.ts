import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertOwnedByShop, requireShopScope } from '../common/shop-scope';
import { CreateCategoryDto } from './dto/create-category.dto';

/**
 * CategoriesService — shop-scoped product categories (plan → Category grid /
 * drill-down). Shopkeeper CRUD is scoped to their OWN shop; the public list is
 * used by the customer category filter.
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public: a shop's categories (for the customer drill-down). */
  listForShop(shopId: string) {
    if (!shopId) {
      throw new BadRequestException('shopId is required');
    }
    return this.prisma.category.findMany({
      where: { shopId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
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
  create(shopId: string | undefined, dto: CreateCategoryDto) {
    const id = requireShopScope(shopId);
    return this.prisma.category.create({
      data: { shopId: id, name: dto.name },
    });
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
    return { deleted: true };
  }
}
