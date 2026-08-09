import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@passwaala/shared';
import { Public } from '../common/public.decorator';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, ShopId } from '../common/current-user.decorator';
import { AuthPayload } from '../auth/auth-payload';
import { ShopsService } from './shops.service';
import { RegisterShopDto } from './dto/register-shop.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { NearbyShopsQuery } from './dto/nearby-shops.query';
import { UpdateShopSettingsDto } from './dto/update-shop-settings.dto';

/**
 * ShopsController — shop management (shopkeeper) + public storefront reads.
 *
 * Shop-owned routes take scope from the JWT (@ShopId()/@CurrentUser()), never
 * from client input — the Shop Data Isolation enforcement point.
 */
@Controller('shops')
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  /**
   * Register the caller's shop. Any authenticated user may register (they become
   * a SHOPKEEPER server-side). Returns the shop + a fresh token scoped to it.
   */
  @Post()
  register(@CurrentUser() user: AuthPayload, @Body() dto: RegisterShopDto) {
    return this.shops.register(user.sub, dto);
  }

  /** The caller's own shop (owner view). */
  @Roles(UserRole.SHOPKEEPER)
  @Get('me')
  findMyShop(@ShopId() shopId: string | undefined) {
    return this.shops.findMyShop(shopId);
  }

  /** All shops owned by the caller (multi-shop home picker). */
  @Roles(UserRole.SHOPKEEPER)
  @Get('mine/all')
  findMyShops(@CurrentUser() user: AuthPayload) {
    return this.shops.findMyShops(user.sub);
  }

  /** Switch active shop → returns a fresh token scoped to that shop. */
  @Roles(UserRole.SHOPKEEPER)
  @Post('switch/:shopId')
  switchShop(@CurrentUser() user: AuthPayload, @Param('shopId') shopId: string) {
    return this.shops.switchShop(user.sub, shopId);
  }

  /** Toggle the caller's shop open/closed. */
  @Roles(UserRole.SHOPKEEPER)
  @Patch('me/open')
  setOpen(@ShopId() shopId: string | undefined, @Body('isOpen') isOpen: boolean) {
    return this.shops.setOpen(shopId, isOpen);
  }

  /** Update the caller's shop settings (economics + profile + working hours). */
  @Roles(UserRole.SHOPKEEPER)
  @Patch('me/settings')
  updateSettings(
    @ShopId() shopId: string | undefined,
    @Body() dto: UpdateShopSettingsDto,
  ) {
    return this.shops.updateSettings(shopId, dto);
  }

  /** Submit KYC for the caller's shop (DRAFT → PENDING_REVIEW). */
  @Roles(UserRole.SHOPKEEPER)
  @Post('me/kyc')
  submitKyc(@ShopId() shopId: string | undefined, @Body() dto: SubmitKycDto) {
    return this.shops.submitKyc(shopId, dto);
  }

  /**
   * Public customer discovery: nearby APPROVED shops (PostGIS radius query).
   * Declared BEFORE :id so "nearby" isn't captured as an id param.
   */
  @Public()
  @Get('nearby')
  findNearby(@Query() query: NearbyShopsQuery) {
    return this.shops.findNearby(query);
  }

  /**
   * Public: shops within 1 km of an anchor shop for multi-shop bulk orders.
   * Declared before :id so it isn't captured as a shop ID param.
   */
  @Public()
  @Get('nearby-for-bulk')
  nearbyForBulk(
    @Query('anchorShopId') anchorShopId: string,
    @Query('offset') offset?: string,
  ) {
    return this.shops.nearbyForBulk(anchorShopId, offset ? parseInt(offset, 10) : 0);
  }

  /**
   * Public, cheap "can this shop deliver right now?" check — called lazily when
   * a customer opens a storefront (NOT for every shop in the list). Declared
   * before :id so "delivery-available" isn't captured as an id param.
   */
  @Public()
  @Get(':id/delivery-available')
  deliveryAvailable(@Param('id') id: string) {
    return this.shops.deliveryAvailableForShop(id);
  }

  /** Shopkeeper: how many times each offer template was used on their orders. */
  @Roles(UserRole.SHOPKEEPER)
  @Get('me/offer-stats')
  offerStats(@ShopId() shopId: string | undefined) {
    return this.shops.offerStats(shopId);
  }

  /** Shopkeeper: submit an appeal message after rejection or suspension. */
  @Roles(UserRole.SHOPKEEPER)
  @Post('me/appeal')
  submitAppeal(@ShopId() shopId: string | undefined, @Body('message') message: string) {
    return this.shops.submitAppeal(shopId, message);
  }

  /** Public storefront view of one shop (only if APPROVED). */
  @Public()
  @Get(':id')
  findPublic(@Param('id') id: string) {
    return this.shops.findPublic(id);
  }
}
