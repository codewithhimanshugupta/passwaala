import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ReferralStatus, ReferralType } from '@passwaala/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ReferralsService — PassWaala Coins referral program (plan → Fast-Follows:
 * Referral program). Coins are a discount VOUCHER, not cash.
 *
 * MVP scope: a user has a stable referralCode; another user applies it once
 * (creates a PENDING Referral). When the referee's 1st order is DELIVERED the
 * referral QUALIFIES and coins credit the referrer's coinBalance. (The ledger
 * REFERRAL_CREDIT against a shop's dues is a later refinement.)
 */
@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's referral code, coin balance, and referrals they've made. */
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true, coinBalance: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, status: true, coinReward: true, createdAt: true },
    });
    return {
      referralCode: user.referralCode,
      coinBalance: user.coinBalance,
      referrals,
    };
  }

  /**
   * Apply someone's referral code (the caller is the referee/new customer).
   * Creates a PENDING customer referral. Blocks self-referral + double-apply.
   */
  async apply(userId: string, code: string) {
    const referrer = await this.prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!referrer) {
      throw new NotFoundException('Invalid referral code');
    }
    if (referrer.id === userId) {
      throw new BadRequestException('You cannot use your own referral code');
    }
    // One referral per referee (anti-abuse).
    const existing = await this.prisma.referral.findFirst({
      where: { refereeUserId: userId, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('You have already used a referral code');
    }
    await this.prisma.referral.create({
      data: {
        referrerId: referrer.id,
        refereeUserId: userId,
        type: ReferralType.CUSTOMER,
        status: ReferralStatus.PENDING,
        coinReward: 25, // ₹25-off voucher for a customer referral (plan)
      },
    });
    return { applied: true };
  }

  /**
   * Called when a customer's order is DELIVERED. If they were referred and the
   * referral is still PENDING, qualify it and credit BOTH referrer and referee
   * 25 coins each (plan: "referrer and referee each get 25 Coins"). Idempotent.
   */
  async qualifyOnDelivery(customerId: string, shopCity?: string) {
    const referral = await this.prisma.referral.findFirst({
      where: { refereeUserId: customerId, status: ReferralStatus.PENDING, deletedAt: null },
    });
    if (!referral) return;

    // Use city-configured coin reward if available, fall back to the stored value.
    const cityCfg = shopCity ? await this.prisma.serviceableCity.findFirst({
      where: { name: { equals: shopCity, mode: 'insensitive' }, deletedAt: null },
      select: { referralCustomerCoins: true },
    }) : null;
    const coins = cityCfg?.referralCustomerCoins ?? referral.coinReward;

    await this.prisma.$transaction([
      this.prisma.referral.update({
        where: { id: referral.id },
        data: { status: ReferralStatus.QUALIFIED },
      }),
      this.prisma.user.update({
        where: { id: referral.referrerId },
        data: { coinBalance: { increment: coins } },
      }),
      this.prisma.user.update({
        where: { id: customerId },
        data: { coinBalance: { increment: coins } },
      }),
    ]);
  }
}
