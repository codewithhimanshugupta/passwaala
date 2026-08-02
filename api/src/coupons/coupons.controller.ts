import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@passwaala/shared';
import { Public } from '../common/public.decorator';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPayload } from '../auth/auth-payload';
import { CouponsService, CreateCouponDto } from './coupons.service';

@Controller('coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  /** Public: coupons for a specific shop (customer picks at checkout). */
  @Public()
  @Get('shop/:shopId')
  listForShop(@Param('shopId') shopId: string) {
    return this.coupons.listForShop(shopId);
  }

  /** Public: validate a coupon code (customer preview before placing order). */
  @Post('validate')
  @Roles(UserRole.CUSTOMER)
  validate(
    @CurrentUser() user: AuthPayload,
    @Body('code') code: string,
    @Body('shopId') shopId: string,
    @Body('subtotalPaise') subtotalPaise: number,
  ) {
    return this.coupons.validate(code, user.sub, shopId, subtotalPaise);
  }
}

@Controller('admin/coupons')
export class AdminCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Post()
  create(@CurrentUser() user: AuthPayload, @Body() dto: CreateCouponDto) {
    return this.coupons.create(user.sub, dto, user.role);
  }

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Get()
  list(@CurrentUser() user: AuthPayload, @Query('all') all?: string) {
    return this.coupons.list(user.sub, user.role, all === 'true');
  }

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateCouponDto>) {
    return this.coupons.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.coupons.remove(id);
  }
}
