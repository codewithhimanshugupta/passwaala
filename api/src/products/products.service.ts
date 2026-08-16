import { BadRequestException, Injectable } from '@nestjs/common';
import { VerificationStatus } from '@nearbaz/shared';
import { PrismaService } from '../prisma/prisma.service';
import { assertOwnedByShop, requireShopScope } from '../common/shop-scope';
import { titleCaseName } from '../common/text.util';
import { MemoryCache } from '../common/memory-cache';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MemoryCache,
  ) {}

  /** How long public catalog reads are cached (ms). Short — a shopkeeper edit
   *  invalidates immediately anyway; this only absorbs repeat customer loads.
   *  Disabled under tests so each case reads fresh state (the in-memory cache
   *  would otherwise survive resetDb between cases). */
  private static readonly PUBLIC_TTL_MS = process.env.NODE_ENV === 'test' ? 0 : 30_000;

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

    const created = await this.prisma.product.create({
      data: {
        shopId: id,
        name: titleCaseName(dto.name),
        pricePaise: dto.pricePaise,
        mrpPaise: dto.mrpPaise,
        stock: dto.stock ?? 0,
        imageUrl: dto.imageUrl,
        description: dto.description,
        available: dto.available ?? true,
        weightGrams: dto.weightGrams,
        categoryId: dto.categoryId,
      },
    });
    this.cache.invalidatePrefix(`products:list:${id}`);
    return created;
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

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        name: dto.name === undefined ? undefined : titleCaseName(dto.name),
        pricePaise: dto.pricePaise,
        mrpPaise: dto.mrpPaise,
        stock: dto.stock,
        imageUrl: dto.imageUrl,
        description: dto.description,
        available: dto.available,
        weightGrams: dto.weightGrams,
      },
    });
    this.cache.invalidatePrefix(`products:list:${id}`);
    this.cache.delete(`products:detail:${productId}`);
    return updated;
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
    this.cache.invalidatePrefix(`products:list:${id}`);
    this.cache.delete(`products:detail:${productId}`);
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
    // Cache the public catalog per shop (short TTL). Invalidated on any product
    // write for this shop (see create/update/remove), so edits show immediately.
    return this.cache.wrap(`products:list:${shopId}`, ProductsService.PUBLIC_TTL_MS, async () => {
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
    });
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

  /**
   * Public: cross-shop product search near a location. Joins Product↔Shop over
   * APPROVED, non-deleted shops within the radius (PostGIS ST_DWithin on the
   * GIST-indexed geog column — never a table scan), matching product name
   * case-insensitively. Ranked by shop distance (nearest first) so the closest
   * shop stocking a match surfaces at the top, then by popularity. Offset
   * pagination with a small default page (a few results shown first).
   */
  async searchAcrossShops(q: {
    lat: number;
    lng: number;
    q: string;
    radiusMeters?: number;
    city?: string;
    limit?: number;
    offset?: number;
  }) {
    const radius = q.radiusMeters ?? 5000;
    const limit = q.limit ?? 5;
    const offset = q.offset ?? 0;
    // Escape LIKE wildcards so a literal % / _ typed by the customer matches
    // literally (backslash is the default ILIKE escape char).
    const term = `%${q.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

    const ttl = process.env.NODE_ENV === 'test' ? 0 : 15_000;
    const cacheKey = [
      'products:search',
      Number(q.lat).toFixed(3),
      Number(q.lng).toFixed(3),
      radius, limit, offset,
      q.city ?? '',
      q.q.trim().toLowerCase(),
    ].join(':');

    return this.cache.wrap(cacheKey, ttl, async () => {
      // Fetch limit+1 to know if there's a next page without a separate COUNT.
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{
          id: string;
          name: string;
          pricePaise: number;
          mrpPaise: number;
          imageUrl: string | null;
          stock: number;
          shop_id: string;
          shop_name: string;
          shop_city: string;
          shop_logo_url: string | null;
          shop_is_open: boolean;
          deliveryFeePaise: number;
          minOrderValuePaise: number;
          distance_meters: number;
        }>
      >(
        `
        SELECT p.id, p.name, p."pricePaise", p."mrpPaise", p."imageUrl", p.stock,
               s.id AS shop_id, s.name AS shop_name, s.city AS shop_city,
               s."logoUrl" AS shop_logo_url, s."isOpen" AS shop_is_open,
               s."deliveryFeePaise", s."minOrderValuePaise",
               EXISTS (
                 SELECT 1 FROM "AdCampaign" ac
                  WHERE ac."shopId" = s.id AND ac.status = 'ACTIVE' AND ac."deletedAt" IS NULL
                    AND ac."startAt" <= NOW() AND (ac."endAt" IS NULL OR ac."endAt" > NOW())
                    AND ac."spentPaise" < ac."totalBudgetPaise"
                    AND (ac."dailyBudgetPaise" = 0 OR ac."dayResetAt" IS NULL
                         OR ac."dayResetAt" < date_trunc('day', NOW())
                         OR ac."spentTodayPaise" < ac."dailyBudgetPaise")
               ) AS is_sponsored,
               ST_Distance(s.geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters
          FROM "Product" p
          JOIN "Shop" s ON s.id = p."shopId"
         WHERE p."deletedAt" IS NULL
           AND ($7::text IS NULL OR s.city ILIKE $7)
           AND p.available = TRUE
           AND s."deletedAt" IS NULL
           AND s."verificationStatus" = 'APPROVED'
           AND s.geog IS NOT NULL
           AND ST_DWithin(s.geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
           AND p.name ILIKE $4
         ORDER BY is_sponsored DESC, distance_meters ASC, p."orderCount" DESC, s."rankScore" DESC, p.id ASC
         LIMIT $5 OFFSET $6
        `,
        q.lng,
        q.lat,
        radius,
        term,
        limit + 1,
        offset,
        q.city ?? null,
      );

      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map((r) => ({
        id: r.id,
        name: r.name,
        pricePaise: r.pricePaise,
        mrpPaise: r.mrpPaise,
        imageUrl: r.imageUrl ?? undefined,
        inStock: r.stock > 0,
        shopId: r.shop_id,
        shopName: r.shop_name,
        shopCity: r.shop_city,
        shopLogoUrl: r.shop_logo_url ?? undefined,
        shopIsOpen: r.shop_is_open,
        deliveryFeePaise: r.deliveryFeePaise,
        minOrderValuePaise: r.minOrderValuePaise,
        distanceMeters: Math.round(Number(r.distance_meters)),
      }));
      return { items, hasMore };
    });
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

  /**
   * Public product DETAIL — loaded lazily when the customer taps a product
   * (the list view omits `description` to stay light). Adds the description on
   * top of the public view. 404 if missing/deleted.
   */
  async publicDetail(productId: string) {
    return this.cache.wrap(`products:detail:${productId}`, ProductsService.PUBLIC_TTL_MS, async () => {
      const p = await this.prisma.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: {
          id: true, shopId: true, name: true, pricePaise: true, mrpPaise: true,
          imageUrl: true, available: true, stock: true, orderCount: true, description: true,
        },
      });
      if (!p) throw new BadRequestException('Product not found');
      return { ...this.toPublicView(p), description: p.description ?? null };
    });
  }
}
