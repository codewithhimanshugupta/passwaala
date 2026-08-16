import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@passwaala/shared';
import { Public } from '../common/public.decorator';
import { Roles } from '../common/roles.decorator';
import { ShopId } from '../common/current-user.decorator';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { SearchProductsQuery } from './dto/search-products.query';

/**
 * ProductsController — public per-shop catalog reads + shopkeeper-only CRUD.
 *
 * Every write/owner route takes the shop scope from @ShopId() (the JWT), NOT
 * from any client-supplied shopId — the Shop Data Isolation enforcement point.
 */
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** Public: list a shop's catalog by shopId query param (APPROVED shops only). */
  @Public()
  @Get()
  listForShop(
    @Query('shopId') shopId: string,
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    // With a search term or category filter, use search; otherwise full catalog.
    if (q || categoryId) {
      return this.products.searchForShop(shopId, { q, categoryId });
    }
    return this.products.listForShop(shopId);
  }

  /** Shopkeeper: list their OWN products. */
  @Roles(UserRole.SHOPKEEPER)
  @Get('mine')
  listMine(@ShopId() shopId: string | undefined) {
    return this.products.listMine(shopId);
  }

  /** Public: cross-shop product search near a location (APPROVED shops only).
   * Declared BEFORE :id so "search" isn't captured as a product id. */
  @Public()
  @Get('search')
  searchAcrossShops(@Query() query: SearchProductsQuery) {
    return this.products.searchAcrossShops(query);
  }

  /** Public: one product's DETAIL (lazy-loaded on tap). After 'mine' so the
   * literal route wins; @Public so no auth needed to view a product. */
  @Public()
  @Get(':id')
  publicDetail(@Param('id') id: string) {
    return this.products.publicDetail(id);
  }

  /** Shopkeeper: create a product in their OWN shop. */
  @Roles(UserRole.SHOPKEEPER)
  @Post()
  create(@ShopId() shopId: string | undefined, @Body() dto: CreateProductDto) {
    return this.products.create(shopId, dto);
  }

  /** Shopkeeper: update a product in their OWN shop. */
  @Roles(UserRole.SHOPKEEPER)
  @Patch(':id')
  update(
    @ShopId() shopId: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(shopId, id, dto);
  }

  /** Shopkeeper: soft-delete a product in their OWN shop. */
  @Roles(UserRole.SHOPKEEPER)
  @Delete(':id')
  remove(@ShopId() shopId: string | undefined, @Param('id') id: string) {
    return this.products.remove(shopId, id);
  }
}
