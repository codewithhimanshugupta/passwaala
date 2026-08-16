import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  UserRole,
  CreateAdCampaign,
  UpdateAdCampaign,
  AdImpressionBatch,
} from '@passwaala/shared';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, ShopId } from '../common/current-user.decorator';
import { requireShopScope } from '../common/shop-scope';
import { AuthPayload } from '../auth/auth-payload';
import { AdsService } from './ads.service';

/**
 * Customer-facing ad tracking. CLICK is authenticated (CUSTOMER) so the billing
 * dedup ("once per customer per day") always has a real customerId — anonymous
 * clicks can't be billed and shouldn't count. Impressions are analytics only.
 */
@Controller('ads')
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  /** Customer tapped a sponsored card → CPC-billable (capped, day-deduped). */
  @Roles(UserRole.CUSTOMER)
  @Post(':campaignId/click')
  click(@CurrentUser() user: AuthPayload, @Param('campaignId') campaignId: string) {
    return this.ads.recordClick(campaignId, user.sub);
  }

  /** Customer saw sponsored cards → unbilled impressions (batch). */
  @Roles(UserRole.CUSTOMER)
  @Post('impressions')
  impressions(@CurrentUser() user: AuthPayload, @Body() dto: AdImpressionBatch) {
    return this.ads.recordImpressions(dto.campaignIds ?? [], user.sub);
  }
}

/**
 * Shopkeeper self-service: view OWN ads + opt in/out + set the daily spend cap.
 * The shop cannot see other shops' data; scope is taken from the JWT (@ShopId).
 */
@Controller('shops/me/ads')
export class ShopAdsController {
  constructor(private readonly ads: AdsService) {}

  /** The caller shop's own ad drill-down (campaigns + counts + charts + dues). */
  @Roles(UserRole.SHOPKEEPER)
  @Get()
  myAds(@ShopId() shopId: string | undefined) {
    return this.ads.shopDrilldown(requireShopScope(shopId));
  }

  /** Shop opts into ads (create-or-activate a campaign at the city default CPC). */
  @Roles(UserRole.SHOPKEEPER)
  @Post('opt-in')
  optIn(
    @ShopId() shopId: string | undefined,
    @Body('totalBudgetPaise') totalBudgetPaise?: number,
    @Body('dailyBudgetPaise') dailyBudgetPaise?: number,
  ) {
    return this.ads.shopOptIn(shopId, { totalBudgetPaise, dailyBudgetPaise });
  }

  /** Shop pauses/resumes its own campaign (opt out / back in). */
  @Roles(UserRole.SHOPKEEPER)
  @Patch(':campaignId/active')
  setActive(
    @ShopId() shopId: string | undefined,
    @Param('campaignId') campaignId: string,
    @Body('active') active: boolean,
  ) {
    return this.ads.shopSetActive(shopId, campaignId, active);
  }

  /** Shop sets its own daily spend cap (paise; 0 = no cap). */
  @Roles(UserRole.SHOPKEEPER)
  @Patch(':campaignId/daily-budget')
  setDailyBudget(
    @ShopId() shopId: string | undefined,
    @Param('campaignId') campaignId: string,
    @Body('dailyBudgetPaise') dailyBudgetPaise: number,
  ) {
    return this.ads.shopSetDailyBudget(shopId, campaignId, dailyBudgetPaise);
  }
}

/**
 * Admin ads back office: campaign CRUD + pricing, global analytics, all-shops
 * cards → per-shop CPC drill-down, and the Premium (curated) toggle.
 */
@Controller('admin/ads')
export class AdminAdsController {
  constructor(private readonly ads: AdsService) {}

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Post('campaigns')
  create(@CurrentUser() user: AuthPayload, @Body() dto: CreateAdCampaign) {
    return this.ads.adminCreate(dto, user.sub);
  }

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Patch('campaigns/:id')
  update(@Param('id') id: string, @Body() dto: UpdateAdCampaign) {
    return this.ads.adminUpdate(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Delete('campaigns/:id')
  remove(@Param('id') id: string) {
    return this.ads.adminRemove(id);
  }

  /** Global analytics: totals + all campaigns + time series (range in days),
   *  scoped to the admin's city (OWNER = all). */
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Get('analytics')
  analytics(@CurrentUser() user: AuthPayload, @Query('range') range?: string) {
    return this.ads.adminAnalytics(user.sub, user.role, range ? Math.max(1, parseInt(range, 10) || 30) : 30);
  }

  /** All shops as cards (with ad rollups) — the AdsScreen landing grid, city-scoped. */
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Get('shops')
  shopCards(@CurrentUser() user: AuthPayload) {
    return this.ads.adminShopCards(user.sub, user.role);
  }

  /** Per-shop CPC drill-down (admin taps a card). */
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Get('shops/:shopId')
  shopDrilldown(@Param('shopId') shopId: string, @Query('range') range?: string) {
    return this.ads.shopDrilldown(shopId, range ? Math.max(1, parseInt(range, 10) || 30) : 30);
  }

  /** Toggle a shop's admin-curated Premium placement (NOT billed). */
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Patch('shops/:shopId/premium')
  setPremium(@Param('shopId') shopId: string, @Body('isPremium') isPremium: boolean) {
    return this.ads.adminSetPremium(shopId, isPremium);
  }
}
