import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AdCampaignStatus,
  AdEventType,
  CreateAdCampaign,
  UpdateAdCampaign,
} from '@passwaala/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { resolveAdminCity } from '../common/admin-city';

/**
 * AdsService — opt-in sponsored placements billed CPC, settled at day-end.
 *
 * Money discipline (the user's explicit concern): integer paise only; a click is
 * billed at most ONCE per (campaign, customer) per day; the billed amount is
 * capped so a day's spend can never exceed the shop's dailyBudgetPaise nor the
 * campaign's lifetime totalBudgetPaise. When the daily cap is hit the ad
 * auto-stops serving (the discovery query drops it) and auto-resumes the next day
 * or the instant the shop raises the cap. NO ledger write happens at click time —
 * the day-end settleAdSpend cron aggregates each campaign's billable clicks into
 * ONE AD_SPEND ledger line (+18% GST) via LedgerService.accrueAdSpend, idempotent
 * per (campaign, day) through AdEvent.settledAt.
 */
@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /** Local calendar midnight — the day boundary for daily caps + click dedup. */
  private startOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  private isStale(dayResetAt: Date | null): boolean {
    return !dayResetAt || dayResetAt < this.startOfToday();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Event tracking (customer app)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Record impressions for sponsored cards shown to a customer. Never billed —
   * pure analytics. Fast batch insert; unknown/inactive campaign ids are ignored.
   */
  async recordImpressions(campaignIds: string[], customerId?: string): Promise<{ recorded: number }> {
    const ids = Array.from(new Set((campaignIds ?? []).filter(Boolean))).slice(0, 50);
    if (ids.length === 0) return { recorded: 0 };
    const campaigns = await this.prisma.adCampaign.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, shopId: true },
    });
    if (campaigns.length === 0) return { recorded: 0 };
    await this.prisma.adEvent.createMany({
      data: campaigns.map((c) => ({
        campaignId: c.id,
        shopId: c.shopId,
        type: AdEventType.IMPRESSION,
        customerId: customerId ?? null,
        billedPaise: 0,
      })),
    });
    return { recorded: campaigns.length };
  }

  /**
   * Record a click on a sponsored card and compute its billable amount (CPC),
   * capped by the daily + lifetime budgets and deduped to once per customer per
   * day. Writes NO ledger entry — settlement is at day-end. Returns whether it
   * was billed so the client can behave identically either way.
   */
  async recordClick(campaignId: string, customerId?: string): Promise<{ billed: boolean; billedPaise: number }> {
    const c = await this.prisma.adCampaign.findFirst({
      where: { id: campaignId, deletedAt: null },
      select: {
        id: true, shopId: true, status: true, cpcPaise: true,
        totalBudgetPaise: true, spentPaise: true,
        dailyBudgetPaise: true, spentTodayPaise: true, dayResetAt: true,
        startAt: true, endAt: true,
      },
    });
    // Unknown / inactive campaign: record nothing (never bill for a dead ad).
    if (!c || c.status !== AdCampaignStatus.ACTIVE) return { billed: false, billedPaise: 0 };
    const now = new Date();
    if (c.startAt > now || (c.endAt && c.endAt <= now)) return { billed: false, billedPaise: 0 };

    // Roll the daily counter over if the stored day is stale.
    const stale = this.isStale(c.dayResetAt);
    const spentTodayBase = stale ? 0 : c.spentTodayPaise;

    // Dedup: one billable click per (campaign, customer) per day. Repeat clicks
    // (and anonymous clicks with no customerId) are recorded unbilled.
    let alreadyBilledToday = false;
    if (customerId) {
      const prior = await this.prisma.adEvent.findFirst({
        where: {
          campaignId: c.id,
          customerId,
          type: AdEventType.CLICK,
          billedPaise: { gt: 0 },
          createdAt: { gte: this.startOfToday() },
        },
        select: { id: true },
      });
      alreadyBilledToday = !!prior;
    }

    // Headroom: never exceed the daily cap nor the lifetime budget.
    const dailyHeadroom = c.dailyBudgetPaise > 0 ? Math.max(0, c.dailyBudgetPaise - spentTodayBase) : Number.MAX_SAFE_INTEGER;
    const lifetimeHeadroom = Math.max(0, c.totalBudgetPaise - c.spentPaise - spentTodayBase);
    let billedPaise = 0;
    if (customerId && !alreadyBilledToday) {
      billedPaise = Math.min(c.cpcPaise, dailyHeadroom, lifetimeHeadroom);
      if (billedPaise < 0) billedPaise = 0;
    }

    await this.prisma.$transaction([
      this.prisma.adEvent.create({
        data: {
          campaignId: c.id,
          shopId: c.shopId,
          type: AdEventType.CLICK,
          customerId: customerId ?? null,
          billedPaise,
        },
      }),
      this.prisma.adCampaign.update({
        where: { id: c.id },
        data: {
          spentTodayPaise: spentTodayBase + billedPaise,
          dayResetAt: now,
        },
      }),
    ]);

    return { billed: billedPaise > 0, billedPaise };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Day-end settlement (cron) — the ONLY place ad spend hits the ledger.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Settle every campaign's un-settled billable clicks into the shop's dues.
   * For each campaign: sum unsettled billedPaise → one AD_SPEND ledger line
   * (+18% GST) via LedgerService.accrueAdSpend; increment spentPaise; mark those
   * events settled; reset the daily counter; flip EXHAUSTED / EXPIRED. Idempotent
   * per (campaign, day) — a second run finds no unsettled events and no-ops.
   */
  @Cron('0 0 * * *')
  async settleAdSpend(): Promise<void> {
    try {
      // Campaigns that have at least one unsettled billable click.
      const grouped = await this.prisma.adEvent.groupBy({
        by: ['campaignId'],
        where: { type: AdEventType.CLICK, billedPaise: { gt: 0 }, settledAt: null },
        _sum: { billedPaise: true },
      });

      let settledCampaigns = 0;
      let totalBasePaise = 0;
      const now = new Date();

      for (const g of grouped) {
        const basePaise = g._sum.billedPaise ?? 0;
        if (basePaise <= 0) continue;
        const campaign = await this.prisma.adCampaign.findFirst({
          where: { id: g.campaignId, deletedAt: null },
          select: { id: true, shopId: true, spentPaise: true, totalBudgetPaise: true, endAt: true, status: true },
        });
        if (!campaign) continue;

        // Accrue the day's spend into the shop's dues (AD_SPEND + 18% GST).
        const accrued = await this.ledger.accrueAdSpend(campaign.shopId, basePaise);

        // Mark exactly the events we summed as settled, then advance the campaign.
        await this.prisma.adEvent.updateMany({
          where: { campaignId: campaign.id, type: AdEventType.CLICK, billedPaise: { gt: 0 }, settledAt: null },
          data: { settledAt: now },
        });
        const newSpent = campaign.spentPaise + basePaise;
        const exhausted = newSpent >= campaign.totalBudgetPaise;
        const expired = campaign.endAt != null && campaign.endAt <= now;
        await this.prisma.adCampaign.update({
          where: { id: campaign.id },
          data: {
            spentPaise: newSpent,
            spentTodayPaise: 0,
            dayResetAt: now,
            status: expired
              ? AdCampaignStatus.EXPIRED
              : exhausted
                ? AdCampaignStatus.EXHAUSTED
                : campaign.status,
          },
        });

        await this.prisma.automationLog.create({
          data: {
            action: 'AD_SPEND_SETTLED',
            detail: `Settled ₹${(basePaise / 100).toFixed(2)} ad spend (+GST → ₹${((accrued?.totalPaise ?? 0) / 100).toFixed(2)} dues)${exhausted ? ' — budget EXHAUSTED' : ''}${expired ? ' — EXPIRED' : ''}`,
            shopId: campaign.shopId,
          },
        }).catch(() => undefined);

        settledCampaigns++;
        totalBasePaise += basePaise;
      }

      // Sweep: expire any ACTIVE campaign past its endAt even with no clicks today.
      await this.prisma.adCampaign.updateMany({
        where: { status: AdCampaignStatus.ACTIVE, deletedAt: null, endAt: { not: null, lte: now } },
        data: { status: AdCampaignStatus.EXPIRED },
      });

      if (settledCampaigns > 0) {
        this.logger.log(`AD SETTLE: ${settledCampaigns} campaign(s), base ₹${(totalBasePaise / 100).toFixed(2)}`);
      }
    } catch (err) {
      this.logger.error(`AD SETTLE failed: ${(err as Error).message}`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Campaign CRUD (admin creates/prices; shop opts in + sets daily cap)
  // ───────────────────────────────────────────────────────────────────────────

  /** Resolve the city's default CPC + budget for a shop (snapshot at create). */
  private async cityDefaultsForShop(shopId: string): Promise<{ cpcPaise: number; budgetPaise: number }> {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { city: true } });
    const city = shop?.city
      ? await this.prisma.serviceableCity.findFirst({
          where: { name: { equals: shop.city, mode: 'insensitive' }, deletedAt: null },
          select: { sponsoredCpcPaise: true, sponsoredDefaultBudgetPaise: true },
        })
      : null;
    return {
      cpcPaise: city?.sponsoredCpcPaise ?? 500,
      budgetPaise: city?.sponsoredDefaultBudgetPaise ?? 50000,
    };
  }

  /** Admin creates a campaign for a shop (prices the CPC, sets total budget). */
  async adminCreate(dto: CreateAdCampaign, createdById: string) {
    const shop = await this.prisma.shop.findFirst({ where: { id: dto.shopId, deletedAt: null }, select: { id: true } });
    if (!shop) throw new NotFoundException('Shop not found');
    const defaults = await this.cityDefaultsForShop(dto.shopId);
    const cpcPaise = dto.cpcPaise ?? defaults.cpcPaise;
    const totalBudgetPaise = dto.totalBudgetPaise ?? defaults.budgetPaise;
    if (cpcPaise <= 0 || totalBudgetPaise <= 0) throw new BadRequestException('CPC and budget must be positive');
    const created = await this.prisma.adCampaign.create({
      data: {
        shopId: dto.shopId,
        cpcPaise,
        totalBudgetPaise,
        dailyBudgetPaise: dto.dailyBudgetPaise ?? 0,
        cityIds: dto.cityIds ?? [],
        startAt: dto.startAt ? new Date(dto.startAt) : new Date(),
        endAt: dto.endAt ? new Date(dto.endAt) : null,
        createdById,
        status: AdCampaignStatus.ACTIVE,
      },
    });
    return this.viewCampaign(created.id);
  }

  /** Admin updates a campaign (cpc/budget/status/cities/end). */
  async adminUpdate(id: string, dto: UpdateAdCampaign) {
    const existing = await this.prisma.adCampaign.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) throw new NotFoundException('Campaign not found');
    await this.prisma.adCampaign.update({
      where: { id },
      data: {
        status: dto.status,
        cpcPaise: dto.cpcPaise,
        totalBudgetPaise: dto.totalBudgetPaise,
        dailyBudgetPaise: dto.dailyBudgetPaise,
        cityIds: dto.cityIds,
        endAt: dto.endAt === undefined ? undefined : dto.endAt ? new Date(dto.endAt) : null,
      },
    });
    return this.viewCampaign(id);
  }

  /** Admin soft-deletes a campaign. */
  async adminRemove(id: string) {
    await this.prisma.adCampaign.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), status: AdCampaignStatus.PAUSED } });
    return { ok: true };
  }

  /** Admin toggles a shop's Premium (curated) placement. */
  async adminSetPremium(shopId: string, isPremium: boolean) {
    const shop = await this.prisma.shop.findFirst({ where: { id: shopId, deletedAt: null }, select: { id: true } });
    if (!shop) throw new NotFoundException('Shop not found');
    await this.prisma.shop.update({ where: { id: shopId }, data: { isPremium } });
    return { shopId, isPremium };
  }

  // ── Shopkeeper self-service (opt-in + own daily cap) ─────────────────────────

  /** Shop opts into ads: create-or-activate a campaign at the city default CPC. */
  async shopOptIn(shopId: string | undefined, opts: { totalBudgetPaise?: number; dailyBudgetPaise?: number }) {
    if (!shopId) throw new ForbiddenException('No shop scope');
    const defaults = await this.cityDefaultsForShop(shopId);
    const existing = await this.prisma.adCampaign.findFirst({
      where: { shopId, deletedAt: null, status: { in: [AdCampaignStatus.ACTIVE, AdCampaignStatus.PAUSED] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.adCampaign.update({
        where: { id: existing.id },
        data: {
          status: AdCampaignStatus.ACTIVE,
          totalBudgetPaise: opts.totalBudgetPaise ?? undefined,
          dailyBudgetPaise: opts.dailyBudgetPaise ?? undefined,
        },
      });
      return this.viewCampaign(existing.id);
    }
    const created = await this.prisma.adCampaign.create({
      data: {
        shopId,
        cpcPaise: defaults.cpcPaise,
        totalBudgetPaise: opts.totalBudgetPaise ?? defaults.budgetPaise,
        dailyBudgetPaise: opts.dailyBudgetPaise ?? 0,
        status: AdCampaignStatus.ACTIVE,
        createdById: null,
      },
    });
    return this.viewCampaign(created.id);
  }

  /** Shop pauses (opts out of) its ads without losing the campaign. */
  async shopSetActive(shopId: string | undefined, campaignId: string, active: boolean) {
    const c = await this.requireOwnCampaign(shopId, campaignId);
    // Never reactivate an exhausted/expired campaign via a simple toggle.
    if (active && (c.status === AdCampaignStatus.EXHAUSTED || c.status === AdCampaignStatus.EXPIRED)) {
      throw new BadRequestException('Campaign budget exhausted or expired — raise the budget/date first');
    }
    await this.prisma.adCampaign.update({
      where: { id: campaignId },
      data: { status: active ? AdCampaignStatus.ACTIVE : AdCampaignStatus.PAUSED },
    });
    return this.viewCampaign(campaignId);
  }

  /** Shop sets its own daily spend cap (0 = no cap). Raising it auto-resumes serving. */
  async shopSetDailyBudget(shopId: string | undefined, campaignId: string, dailyBudgetPaise: number) {
    await this.requireOwnCampaign(shopId, campaignId);
    if (dailyBudgetPaise < 0) throw new BadRequestException('Daily cap cannot be negative');
    await this.prisma.adCampaign.update({ where: { id: campaignId }, data: { dailyBudgetPaise } });
    return this.viewCampaign(campaignId);
  }

  private async requireOwnCampaign(shopId: string | undefined, campaignId: string) {
    if (!shopId) throw new ForbiddenException('No shop scope');
    const c = await this.prisma.adCampaign.findFirst({
      where: { id: campaignId, shopId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!c) throw new NotFoundException('Campaign not found for this shop');
    return c;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Analytics
  // ───────────────────────────────────────────────────────────────────────────

  /** Per-campaign impression/click rollups keyed by campaignId. */
  private async campaignEventRollups(campaignIds: string[]): Promise<Map<string, { impressions: number; clicks: number }>> {
    const map = new Map<string, { impressions: number; clicks: number }>();
    if (campaignIds.length === 0) return map;
    const rows = await this.prisma.adEvent.groupBy({
      by: ['campaignId', 'type'],
      where: { campaignId: { in: campaignIds } },
      _count: { _all: true },
    });
    for (const id of campaignIds) map.set(id, { impressions: 0, clicks: 0 });
    for (const r of rows) {
      const e = map.get(r.campaignId) ?? { impressions: 0, clicks: 0 };
      if (r.type === AdEventType.IMPRESSION) e.impressions = r._count._all;
      else e.clicks = r._count._all;
      map.set(r.campaignId, e);
    }
    return map;
  }

  private ctr(clicks: number, impressions: number): number {
    return impressions > 0 ? Number((clicks / impressions).toFixed(4)) : 0;
  }

  /** Build the AdCampaignView for one campaign (with its event rollup). */
  async viewCampaign(id: string) {
    const c = await this.prisma.adCampaign.findFirst({
      where: { id },
      include: { shop: { select: { name: true } } },
    });
    if (!c) throw new NotFoundException('Campaign not found');
    const roll = (await this.campaignEventRollups([id])).get(id) ?? { impressions: 0, clicks: 0 };
    return this.toView(c, roll);
  }

  private toView(
    c: {
      id: string; shopId: string; status: string; cpcPaise: number;
      totalBudgetPaise: number; spentPaise: number; dailyBudgetPaise: number; spentTodayPaise: number;
      dayResetAt: Date | null; cityIds: string[]; startAt: Date; endAt: Date | null;
      createdAt: Date; updatedAt: Date; shop: { name: string };
    },
    roll: { impressions: number; clicks: number },
  ) {
    const now = new Date();
    const spentToday = this.isStale(c.dayResetAt) ? 0 : c.spentTodayPaise;
    const serving =
      c.status === AdCampaignStatus.ACTIVE &&
      c.startAt <= now &&
      (c.endAt == null || c.endAt > now) &&
      c.spentPaise < c.totalBudgetPaise &&
      (c.dailyBudgetPaise === 0 || spentToday < c.dailyBudgetPaise);
    return {
      id: c.id,
      shopId: c.shopId,
      shopName: c.shop.name,
      status: c.status as AdCampaignStatus,
      cpcPaise: c.cpcPaise,
      totalBudgetPaise: c.totalBudgetPaise,
      spentPaise: c.spentPaise,
      dailyBudgetPaise: c.dailyBudgetPaise,
      spentTodayPaise: spentToday,
      serving,
      cityIds: c.cityIds,
      startAt: c.startAt.toISOString(),
      endAt: c.endAt ? c.endAt.toISOString() : null,
      impressions: roll.impressions,
      clicks: roll.clicks,
      ctr: this.ctr(roll.clicks, roll.impressions),
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  /** Daily time series of impressions/clicks/spend, optionally scoped to a shop
   *  or a city (city scoping keeps admin aggregates fast as the platform grows). */
  private async series(sinceDays: number, opts: { shopId?: string; city?: string | null } = {}) {
    const since = new Date(this.startOfToday().getTime() - (sinceDays - 1) * 86400000);
    const params: unknown[] = [since];
    let where = `e."createdAt" >= $1`;
    let join = '';
    if (opts.shopId) {
      params.push(opts.shopId);
      where += ` AND e."shopId" = $${params.length}`;
    }
    if (opts.city) {
      join = `JOIN "Shop" s ON s.id = e."shopId"`;
      params.push(opts.city);
      where += ` AND s.city ILIKE $${params.length}`;
    }
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ bucket: Date; impressions: bigint; clicks: bigint; spent: bigint }>
    >(
      `
      SELECT date_trunc('day', e."createdAt") AS bucket,
             SUM(CASE WHEN e.type = 'IMPRESSION' THEN 1 ELSE 0 END) AS impressions,
             SUM(CASE WHEN e.type = 'CLICK' THEN 1 ELSE 0 END) AS clicks,
             SUM(e."billedPaise") AS spent
        FROM "AdEvent" e ${join}
       WHERE ${where}
       GROUP BY 1 ORDER BY 1
      `,
      ...params,
    );
    return rows.map((r) => ({
      bucket: new Date(r.bucket).toISOString().slice(0, 10),
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
      spentPaise: Number(r.spent),
    }));
  }

  /** Admin dashboard: totals + all campaigns + time series, scoped to the admin's
   *  city (OWNER = all cities). City is the FIRST filter so the query stays cheap
   *  as the platform grows to many cities/shops. */
  async adminAnalytics(adminId: string, role: string, rangeDays = 30) {
    const city = await resolveAdminCity(this.prisma, adminId, role);
    const campaignsRaw = await this.prisma.adCampaign.findMany({
      where: { deletedAt: null, ...(city ? { shop: { city: { equals: city, mode: 'insensitive' } } } : {}) },
      include: { shop: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const rolls = await this.campaignEventRollups(campaignsRaw.map((c) => c.id));
    const campaigns = campaignsRaw.map((c) => this.toView(c, rolls.get(c.id) ?? { impressions: 0, clicks: 0 }));
    const totals = this.rollupTotals(campaigns);
    const series = await this.series(rangeDays, { city });
    return { totals, campaigns, series };
  }

  private rollupTotals(campaigns: ReturnType<AdsService['toView']>[]) {
    const impressions = campaigns.reduce((s, c) => s + c.impressions, 0);
    const clicks = campaigns.reduce((s, c) => s + c.clicks, 0);
    return {
      campaigns: campaigns.length,
      activeCampaigns: campaigns.filter((c) => c.status === AdCampaignStatus.ACTIVE).length,
      impressions,
      clicks,
      ctr: this.ctr(clicks, impressions),
      spentPaise: campaigns.reduce((s, c) => s + c.spentPaise, 0),
    };
  }

  /** Admin: every shop as a card with its ad rollup (tap → drill-down), scoped
   *  to the admin's city (OWNER = all). City is the first filter. */
  async adminShopCards(adminId: string, role: string) {
    const city = await resolveAdminCity(this.prisma, adminId, role);
    const shops = await this.prisma.shop.findMany({
      where: { deletedAt: null, ...(city ? { city: { equals: city, mode: 'insensitive' } } : {}) },
      select: { id: true, name: true, shopCategory: true, city: true, isPremium: true },
      orderBy: { name: 'asc' },
    });
    const shopIds = shops.map((s) => s.id);
    const campaigns = await this.prisma.adCampaign.findMany({
      where: { deletedAt: null, shopId: { in: shopIds } },
      include: { shop: { select: { name: true } } },
    });
    const rolls = await this.campaignEventRollups(campaigns.map((c) => c.id));
    const byShop = new Map<string, ReturnType<AdsService['toView']>[]>();
    for (const c of campaigns) {
      const v = this.toView(c, rolls.get(c.id) ?? { impressions: 0, clicks: 0 });
      const arr = byShop.get(c.shopId) ?? [];
      arr.push(v);
      byShop.set(c.shopId, arr);
    }
    return shops.map((s) => {
      const cs = byShop.get(s.id) ?? [];
      const impressions = cs.reduce((a, c) => a + c.impressions, 0);
      const clicks = cs.reduce((a, c) => a + c.clicks, 0);
      return {
        shopId: s.id,
        shopName: s.name,
        shopCategory: s.shopCategory,
        city: s.city,
        isPromoted: cs.some((c) => c.status === AdCampaignStatus.ACTIVE),
        isPremium: s.isPremium,
        campaignCount: cs.length,
        impressions,
        clicks,
        ctr: this.ctr(clicks, impressions),
        spentPaise: cs.reduce((a, c) => a + c.spentPaise, 0),
      };
    });
  }

  /** Per-shop drill-down (admin taps a card, or the shop views its own). */
  async shopDrilldown(shopId: string, rangeDays = 30) {
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!shop) throw new NotFoundException('Shop not found');
    const campaignsRaw = await this.prisma.adCampaign.findMany({
      where: { shopId, deletedAt: null },
      include: { shop: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const rolls = await this.campaignEventRollups(campaignsRaw.map((c) => c.id));
    const campaigns = campaignsRaw.map((c) => this.toView(c, rolls.get(c.id) ?? { impressions: 0, clicks: 0 }));
    const series = await this.series(rangeDays, { shopId });
    // Outstanding ad-spend dues = sum of AD_SPEND ledger lines still owed.
    const adDues = await this.prisma.ledgerEntry.aggregate({
      where: { shopId, type: 'AD_SPEND', status: { not: 'PAID' }, deletedAt: null },
      _sum: { totalPaise: true },
    });
    return {
      shopId: shop.id,
      shopName: shop.name,
      totals: this.rollupTotals(campaigns),
      campaigns,
      series,
      outstandingAdDuesPaise: adDues._sum.totalPaise ?? 0,
    };
  }
}
