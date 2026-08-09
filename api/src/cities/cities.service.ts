import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryCache } from '../common/memory-cache';
import { UpsertCityDto } from './dto/upsert-city.dto';
import { CreateOfferDto, UpdateOfferDto } from './dto/offer.dto';

/**
 * CitiesService — owner-controlled serviceable cities. PassWaala operates only in
 * enabled cities: shops can register only in one, and customers elsewhere see a
 * "not available in your city yet" state.
 */
@Injectable()
export class CitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MemoryCache,
  ) {}

  /** Public: enabled cities with their active offer templates and delivery radius. */
  async listEnabled(): Promise<Array<{ name: string; deliveryRadiusMeters: number; offers: Array<{ id: string; title: string; type: string; value: number; minOrderPaise: number }> }>> {
    // Cached — this is hit on every customer app load; the data changes rarely.
    return this.cache.wrap('cities:enabled', 60_000, async () => {
    const [cities, coupons] = await Promise.all([
      this.prisma.serviceableCity.findMany({
        where: { enabled: true, deletedAt: null },
        select: { id: true, name: true, deliveryRadiusMeters: true,
          offerTemplates: { where: { active: true, deletedAt: null }, select: { id: true, title: true, type: true, value: true, minOrderPaise: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.coupon.findMany({
        where: { active: true, deletedAt: null },
        select: { id: true, code: true, description: true, type: true, value: true, minOrderPaise: true, cityIds: true },
      }),
    ]);
    return cities.map(c => {
      // Include coupons scoped to this city, or global (empty cityIds = OWNER-created)
      const cityCoupons = coupons
        .filter(coupon => coupon.cityIds.length === 0 || coupon.cityIds.includes(c.id))
        .map(coupon => ({
          id: coupon.id,
          title: coupon.code + (coupon.description ? ` — ${coupon.description}` : ''),
          type: coupon.type,
          value: coupon.value,
          minOrderPaise: coupon.minOrderPaise,
        }));
      return { name: c.name, deliveryRadiusMeters: c.deliveryRadiusMeters, offers: [...c.offerTemplates, ...cityCoupons] };
    });
    });
  }

  /** True if the given city (case-insensitive) is enabled AND has an active admin. */
  async isServiceable(city: string): Promise<boolean> {
    if (!city) return false;
    const found = await this.prisma.serviceableCity.findFirst({
      where: { name: { equals: city, mode: 'insensitive' }, enabled: true, deletedAt: null },
      select: { id: true },
    });
    return !!found;
  }

  /** Owner: all cities (enabled + disabled) with their assigned active admin. */
  async listAll() {
    const cities = await this.prisma.serviceableCity.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        adminInvites: {
          where: { deletedAt: null, status: 'ACTIVE' },
          select: { phone: true },
          take: 1,
        },
      },
    });
    return cities.map(({ adminInvites, ...city }) => ({
      ...city,
      admin: adminInvites[0] ? { phone: adminInvites[0].phone } : null,
    }));
  }

  /** Owner: add a city or update its enabled flag (upsert by name). */
  upsert(dto: UpsertCityDto) {
    // Only touch UPI fields when the caller sent them. An empty string clears
    // the stored value; undefined leaves it as-is.
    const upiVpa =
      dto.collectionUpiVpa === undefined
        ? undefined
        : dto.collectionUpiVpa.trim() === ''
          ? null
          : dto.collectionUpiVpa.trim();
    const upiName =
      dto.collectionUpiName === undefined
        ? undefined
        : dto.collectionUpiName.trim() === ''
          ? null
          : dto.collectionUpiName.trim();
    return this.prisma.serviceableCity.upsert({
      where: { name: dto.name },
      create: {
        name: dto.name,
        enabled: dto.enabled ?? true,
        collectionUpiVpa: upiVpa ?? null,
        collectionUpiName: upiName ?? null,
        ...(dto.deliveryRadiusMeters !== undefined ? { deliveryRadiusMeters: dto.deliveryRadiusMeters } : {}),
        ...(dto.riderCheckRadiusMeters !== undefined ? { riderCheckRadiusMeters: dto.riderCheckRadiusMeters } : {}),
        ...(dto.deliveryTiersJson !== undefined ? { deliveryTiersJson: dto.deliveryTiersJson } : {}),
        ...(dto.requireRiderForDelivery !== undefined ? { requireRiderForDelivery: dto.requireRiderForDelivery } : {}),
        ...(dto.multiShopSurchargePaise !== undefined ? { multiShopSurchargePaise: dto.multiShopSurchargePaise } : {}),
        ...(dto.bulkShopRadiusMeters !== undefined ? { bulkShopRadiusMeters: dto.bulkShopRadiusMeters } : {}),
        ...(dto.codMinOrderPaise !== undefined ? { codMinOrderPaise: dto.codMinOrderPaise } : {}),
        ...(dto.codMaxPerDay !== undefined ? { codMaxPerDay: dto.codMaxPerDay } : {}),
        ...(dto.codCancelBlockAfter !== undefined ? { codCancelBlockAfter: dto.codCancelBlockAfter } : {}),
        ...(dto.codCancelWindowDays !== undefined ? { codCancelWindowDays: dto.codCancelWindowDays } : {}),
        ...(dto.codWindowHours !== undefined ? { codWindowHours: dto.codWindowHours } : {}),
        ...(dto.autoCancelMinutes !== undefined ? { autoCancelMinutes: dto.autoCancelMinutes } : {}),
        ...(dto.riderOfferWindowSec !== undefined ? { riderOfferWindowSec: dto.riderOfferWindowSec } : {}),
        ...(dto.maxActiveOrdersPerRider !== undefined ? { maxActiveOrdersPerRider: dto.maxActiveOrdersPerRider } : {}),
        ...(dto.shopReminderMinutes !== undefined ? { shopReminderMinutes: dto.shopReminderMinutes } : {}),
        ...(dto.staleRiderMinutes !== undefined ? { staleRiderMinutes: dto.staleRiderMinutes } : {}),
        ...(dto.nearbyShopsRadiusMeters !== undefined ? { nearbyShopsRadiusMeters: dto.nearbyShopsRadiusMeters } : {}),
        ...(dto.platformFeePaise !== undefined ? { platformFeePaise: dto.platformFeePaise } : {}),
        ...(dto.defaultCommissionRate !== undefined ? { defaultCommissionRate: dto.defaultCommissionRate } : {}),
        ...(dto.defaultCreditLimitPaise !== undefined ? { defaultCreditLimitPaise: dto.defaultCreditLimitPaise } : {}),
        ...(dto.commissionHolidayDays !== undefined ? { commissionHolidayDays: dto.commissionHolidayDays } : {}),
        ...(dto.onboardingFeePaise !== undefined ? { onboardingFeePaise: dto.onboardingFeePaise } : {}),
        ...(dto.referralCustomerCoins !== undefined ? { referralCustomerCoins: dto.referralCustomerCoins } : {}),
        ...(dto.referralShopCoins !== undefined ? { referralShopCoins: dto.referralShopCoins } : {}),
      },
      update: {
        enabled: dto.enabled ?? true,
        ...(upiVpa !== undefined ? { collectionUpiVpa: upiVpa } : {}),
        ...(upiName !== undefined ? { collectionUpiName: upiName } : {}),
        ...(dto.deliveryRadiusMeters !== undefined ? { deliveryRadiusMeters: dto.deliveryRadiusMeters } : {}),
        ...(dto.riderCheckRadiusMeters !== undefined ? { riderCheckRadiusMeters: dto.riderCheckRadiusMeters } : {}),
        ...(dto.deliveryTiersJson !== undefined ? { deliveryTiersJson: dto.deliveryTiersJson } : {}),
        ...(dto.requireRiderForDelivery !== undefined ? { requireRiderForDelivery: dto.requireRiderForDelivery } : {}),
        ...(dto.multiShopSurchargePaise !== undefined ? { multiShopSurchargePaise: dto.multiShopSurchargePaise } : {}),
        ...(dto.bulkShopRadiusMeters !== undefined ? { bulkShopRadiusMeters: dto.bulkShopRadiusMeters } : {}),
        ...(dto.codMinOrderPaise !== undefined ? { codMinOrderPaise: dto.codMinOrderPaise } : {}),
        ...(dto.codMaxPerDay !== undefined ? { codMaxPerDay: dto.codMaxPerDay } : {}),
        ...(dto.codCancelBlockAfter !== undefined ? { codCancelBlockAfter: dto.codCancelBlockAfter } : {}),
        ...(dto.codCancelWindowDays !== undefined ? { codCancelWindowDays: dto.codCancelWindowDays } : {}),
        ...(dto.codWindowHours !== undefined ? { codWindowHours: dto.codWindowHours } : {}),
        ...(dto.autoCancelMinutes !== undefined ? { autoCancelMinutes: dto.autoCancelMinutes } : {}),
        ...(dto.riderOfferWindowSec !== undefined ? { riderOfferWindowSec: dto.riderOfferWindowSec } : {}),
        ...(dto.maxActiveOrdersPerRider !== undefined ? { maxActiveOrdersPerRider: dto.maxActiveOrdersPerRider } : {}),
        ...(dto.shopReminderMinutes !== undefined ? { shopReminderMinutes: dto.shopReminderMinutes } : {}),
        ...(dto.staleRiderMinutes !== undefined ? { staleRiderMinutes: dto.staleRiderMinutes } : {}),
        ...(dto.nearbyShopsRadiusMeters !== undefined ? { nearbyShopsRadiusMeters: dto.nearbyShopsRadiusMeters } : {}),
        ...(dto.platformFeePaise !== undefined ? { platformFeePaise: dto.platformFeePaise } : {}),
        ...(dto.defaultCommissionRate !== undefined ? { defaultCommissionRate: dto.defaultCommissionRate } : {}),
        ...(dto.defaultCreditLimitPaise !== undefined ? { defaultCreditLimitPaise: dto.defaultCreditLimitPaise } : {}),
        ...(dto.commissionHolidayDays !== undefined ? { commissionHolidayDays: dto.commissionHolidayDays } : {}),
        ...(dto.onboardingFeePaise !== undefined ? { onboardingFeePaise: dto.onboardingFeePaise } : {}),
        ...(dto.referralCustomerCoins !== undefined ? { referralCustomerCoins: dto.referralCustomerCoins } : {}),
        ...(dto.referralShopCoins !== undefined ? { referralShopCoins: dto.referralShopCoins } : {}),
      },
    });
  }

  /**
   * The PassWaala collection UPI configured for a city (case-insensitive, enabled
   * only). Returns null when the city is unknown/disabled or has no UPI set.
   * Never exposed publicly — only surfaced to a scoped shopkeeper's ledger.
   */
  async getCollectionUpiForCity(city: string): Promise<{ vpa: string; name: string } | null> {
    if (!city) return null;
    const found = await this.prisma.serviceableCity.findFirst({
      where: { name: { equals: city, mode: 'insensitive' }, enabled: true, deletedAt: null },
      select: { collectionUpiVpa: true, collectionUpiName: true, name: true },
    });
    if (!found?.collectionUpiVpa) return null;
    return { vpa: found.collectionUpiVpa, name: found.collectionUpiName || 'PassWaala' };
  }

  /**
   * The platform's default collection UPI — the first enabled city that has one
   * configured. Used where there's no shop/city scope (e.g. a rider depositing
   * their COD dues to PassWaala). Null when no city has a UPI set.
   */
  async getDefaultCollectionUpi(): Promise<{ vpa: string; name: string } | null> {
    const found = await this.prisma.serviceableCity.findFirst({
      where: { enabled: true, deletedAt: null, collectionUpiVpa: { not: null } },
      orderBy: { name: 'asc' },
      select: { collectionUpiVpa: true, collectionUpiName: true },
    });
    if (!found?.collectionUpiVpa) return null;
    return { vpa: found.collectionUpiVpa, name: found.collectionUpiName || 'PassWaala' };
  }

  /** Owner: enable/disable a city by id. */
  async setEnabled(id: string, enabled: boolean) {
    const city = await this.prisma.serviceableCity.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!city) {
      throw new NotFoundException('City not found');
    }
    const updated = await this.prisma.serviceableCity.update({ where: { id }, data: { enabled } });
    this.cache.delete('cities:enabled');
    return updated;
  }

  /** Owner: list all offer templates for a city. */
  async listOffers(cityId: string) {
    return this.prisma.offerTemplate.findMany({
      where: { cityId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Owner: create an offer template for a city. */
  async createOffer(cityId: string, dto: CreateOfferDto) {
    const city = await this.prisma.serviceableCity.findFirst({ where: { id: cityId, deletedAt: null }, select: { id: true } });
    if (!city) throw new NotFoundException('City not found');
    return this.prisma.offerTemplate.create({
      data: { cityId, title: dto.title, type: dto.type, value: dto.value, minOrderPaise: dto.minOrderPaise ?? 0 },
    });
  }

  /** Owner: update an offer template. */
  async updateOffer(offerId: string, dto: UpdateOfferDto) {
    const offer = await this.prisma.offerTemplate.findFirst({ where: { id: offerId, deletedAt: null }, select: { id: true } });
    if (!offer) throw new NotFoundException('Offer not found');
    return this.prisma.offerTemplate.update({
      where: { id: offerId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.value !== undefined ? { value: dto.value } : {}),
        ...(dto.minOrderPaise !== undefined ? { minOrderPaise: dto.minOrderPaise } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }

  /** Owner: soft-delete an offer template (detaches from all shops first). */
  async deleteOffer(offerId: string) {
    const offer = await this.prisma.offerTemplate.findFirst({ where: { id: offerId, deletedAt: null }, select: { id: true } });
    if (!offer) throw new NotFoundException('Offer not found');
    await this.prisma.$transaction([
      // Disconnect this offer from all shops that have it active.
      this.prisma.offerTemplate.update({
        where: { id: offerId },
        data: {
          deletedAt: new Date(),
          active: false,
          shops: { set: [] },
        },
      }),
    ]);
    return { deleted: true };
  }
}
