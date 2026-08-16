import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@nearbaz/shared';
import { Public } from '../common/public.decorator';
import { Roles } from '../common/roles.decorator';
import { ShopId } from '../common/current-user.decorator';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';

/**
 * CategoriesController — public per-shop category list + shopkeeper-only CRUD.
 * Shop scope for writes comes from @ShopId() (JWT).
 */
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** Public: a shop's categories (customer drill-down). */
  @Public()
  @Get()
  listForShop(@Query('shopId') shopId: string) {
    return this.categories.listForShop(shopId);
  }

  /** Shopkeeper: their own categories. */
  @Roles(UserRole.SHOPKEEPER)
  @Get('mine')
  listMine(@ShopId() shopId: string | undefined) {
    return this.categories.listMine(shopId);
  }

  /** Shopkeeper: create a category. */
  @Roles(UserRole.SHOPKEEPER)
  @Post()
  create(@ShopId() shopId: string | undefined, @Body() dto: CreateCategoryDto) {
    return this.categories.create(shopId, dto);
  }

  /** Shopkeeper: delete a category. */
  @Roles(UserRole.SHOPKEEPER)
  @Delete(':id')
  remove(@ShopId() shopId: string | undefined, @Param('id') id: string) {
    return this.categories.remove(shopId, id);
  }
}
