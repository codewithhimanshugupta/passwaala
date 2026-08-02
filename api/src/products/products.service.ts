import { BadRequestException, Injectable } from '@nestjs/common';
import { VerificationStatus } from '@passwaala/shared';
import { PrismaService } from '../prisma/prisma.service';
import { assertOwnedByShop, requireShopScope } from '../common/shop-scope';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

/**
 * ProductsService — product CRUD scoped to the shopkeeper's OWN shop, plus the
 * public per-shop catalog read (plan → Catalog & Product, Shop Data Isolation).
 *
 * HARD RULES enforced:
 *  - Every shopkeeper op is scoped by shopId from the JWT (requireShopScope),
 *    and every /:id load is ownership-checked (assertOwnedByShop → 404 for
 *    another shop's product; no existence leak). This is the CI-tested
 *    isolation rule.
 *  - Prices are integer paise. Customers see in/out-of-stock only, never exact
 *    stock levels.
 *  - The public catalog only lists products of APPROVED shops.
 */
@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Shopkeeper: list their OWN shop's products (full view incl. stock). */
  async listMine(shopId: string | undefined) {
    const id = requireShopScope(shopId);
    return this.prisma.product.findMany({
      where: { shopId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Shopkeeper: create a product in their OWN shop. */
  async create(shopId: string | undefined, dto: CreateProductDto) {
    const id = requireShopScope(shopId);

    // If a category is given, it must belong to THIS shop (isolation).
    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, deletedAt: null },
        select: { shopId: true },
      });
      assertOwnedByShop(category, id);
    }

    return this.prisma.product.create({
      data: {
        shopId: id,
        name: dto.name,
        pricePaise: dto.pricePaise,
        mrpPaise: dto.mrpPaise,
        stock: dto.stock ?? 0,
        imageUrl: dto.imageUrl,
        available: dto.available ?? true,
        weightGrams: dto.weightGrams,
        categoryId: dto.categoryId,
      },
    });
  }

  /** Shopkeeper: update a product in their OWN shop (IDOR-guarded). */
  async update(shopId: string | undefined, productId: string, dto: UpdateProductDto) {
    const id = requireShopScope(shopId);
    const existing = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, shopId: true },
    });
    // 404 if missing OR belongs to another shop — never reveals existence.
    assertOwnedByShop(existing, id);

    return this.prisma.product.update({
      where: { id: productId },
      data: {
        name: dto.name,
        pricePaise: dto.pricePaise,
        mrpPaise: dto.mrpPaise,
        stock: dto.stock,
        imageUrl: dto.imageUrl,
        available: dto.available,
        weightGrams: dto.weightGrams,
      },
    });
  }

  /** Shopkeeper: soft-delete a product in their OWN shop (IDOR-guarded). */
  async remove(shopId: string | undefined, productId: string) {
    const id = requireShopScope(shopId);
    const existing = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, shopId: true },
    });
    assertOwnedByShop(existing, id);

    await this.prisma.product.update({
      where: { id: productId },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }

  /**
   * Public: list a shop's catalog. Only for an APPROVED shop; returns the
   * customer-safe view (in/out-of-stock, never exact stock levels).
   */
  async listForShop(shopId: string) {
    if (!shopId) {
      throw new BadRequestException('shopId is required');
    }
    const shop = await this.prisma.shop.findFirst({
      where: {
        id: shopId,
        deletedAt: null,
        verificationStatus: VerificationStatus.APPROVED,
      },
      select: { id: true },
    });
    if (!shop) {
      // Unapproved / missing shop has no public catalog.
      throw new BadRequestException('Shop not found');
    }

    const products = await this.prisma.product.findMany({
      where: { shopId, deletedAt: null, available: true },
      orderBy: { orderCount: 'desc' },
    });
    return products.map((p) => this.toPublicView(p));
  }

  /**
   * Public: search a shop's catalog by name (case-insensitive contains) and/or
   * category. Powers the customer search bar + category drill-down.
   */
  async searchForShop(shopId: string, opts: { q?: string; categoryId?: string }) {
    if (!shopId) {
      throw new BadRequestException('shopId is required');
    }
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, deletedAt: null, verificationStatus: VerificationStatus.APPROVED },
      select: { id: true },
    });
    if (!shop) {
      throw new BadRequestException('Shop not found');
    }
    const products = await this.prisma.product.findMany({
      where: {
        shopId,
        deletedAt: null,
        available: true,
        ...(opts.q ? { name: { contains: opts.q, mode: 'insensitive' } } : {}),
        ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
      },
      orderBy: { orderCount: 'desc' },
    });
    return products.map((p) => this.toPublicView(p));
  }

  /** Customer-facing product view — no exact stock (PII minimization). */
  private toPublicView(p: {
    id: string;
    shopId: string;
    name: string;
    pricePaise: number;
    mrpPaise: number;
    imageUrl: string | null;
    available: boolean;
    stock: number;
    orderCount: number;
  }) {
    return {
      id: p.id,
      shopId: p.shopId,
      name: p.name,
      pricePaise: p.pricePaise,
      mrpPaise: p.mrpPaise,
      imageUrl: p.imageUrl ?? undefined,
      available: p.available,
      inStock: p.stock > 0,
      orderCount: p.orderCount,
    };
  }
}
