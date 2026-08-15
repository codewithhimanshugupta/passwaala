import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerEntryType, RiderLedgerType } from '@passwaala/shared';

@Injectable()
export class PaymentClaimsService {
  constructor(private readonly prisma: PrismaService) {}

  async claimShopPayment(shopId: string | undefined, amountPaise: number) {
    if (!shopId) throw new BadRequestException('No shop scope');
    if (!Number.isInteger(amountPaise) || amountPaise <= 0)
      throw new BadRequestException('Amount must be a positive integer of paise');
    const shop = await this.prisma.shop.findFirst({ where: { id: shopId, deletedAt: null }, select: { id: true } });
    if (!shop) throw new NotFoundException('Shop not found');
    return this.prisma.paymentClaim.create({
      data: { entityType: 'SHOP', shopId, amountPaise },
      select: { id: true, entityType: true, shopId: true, amountPaise: true, status: true, claimedAt: true },
    });
  }

  async claimRiderPayment(riderUserId: string, amountPaise: number) {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0)
      throw new BadRequestException('Amount must be a positive integer of paise');
    const profile = await this.prisma.riderProfile.findFirst({ where: { userId: riderUserId }, select: { userId: true } });
    if (!profile) throw new NotFoundException('Rider profile not found');
    return this.prisma.paymentClaim.create({
      data: { entityType: 'RIDER', riderUserId, amountPaise },
      select: { id: true, entityType: true, riderUserId: true, amountPaise: true, status: true, claimedAt: true },
    });
  }

  async listPending() {
    const claims = await this.prisma.paymentClaim.findMany({
      where: { status: 'PENDING' },
      orderBy: { claimedAt: 'desc' },
    });

    // Resolve shop names and rider names in parallel
    const shopIds = [...new Set(claims.filter(c => c.entityType === 'SHOP' && c.shopId).map(c => c.shopId!))];
    const riderIds = [...new Set(claims.filter(c => c.entityType === 'RIDER' && c.riderUserId).map(c => c.riderUserId!))];

    const [shops, riders] = await Promise.all([
      shopIds.length
        ? this.prisma.shop.findMany({ where: { id: { in: shopIds } }, select: { id: true, name: true } })
        : [],
      riderIds.length
        ? this.prisma.user.findMany({ where: { id: { in: riderIds } }, select: { id: true, name: true, phone: true } })
        : [],
    ]);

    const shopMap = Object.fromEntries(shops.map(s => [s.id, s.name]));
    const riderMap = Object.fromEntries(riders.map(r => [r.id, { name: r.name, phone: r.phone }]));

    return claims.map(c => ({
      id: c.id,
      entityType: c.entityType,
      shopId: c.shopId ?? undefined,
      shopName: c.shopId ? shopMap[c.shopId] : undefined,
      riderUserId: c.riderUserId ?? undefined,
      riderName: c.riderUserId ? riderMap[c.riderUserId]?.name : undefined,
      riderPhone: c.riderUserId ? riderMap[c.riderUserId]?.phone : undefined,
      amountPaise: c.amountPaise,
      claimedAt: c.claimedAt,
    }));
  }

  async approveClaim(claimId: string, adminId: string) {
    const claim = await this.prisma.paymentClaim.findFirst({ where: { id: claimId, status: 'PENDING' } });
    if (!claim) throw new NotFoundException('Claim not found or already processed');

    if (claim.entityType === 'SHOP') {
      await this.approveShopClaim(claim, adminId);
    } else {
      await this.approveRiderClaim(claim, adminId);
    }
    return { approved: true };
  }

  private async approveShopClaim(claim: { id: string; shopId: string | null; amountPaise: number }, adminId: string) {
    if (!claim.shopId) throw new BadRequestException('Claim has no shopId');
    const shop = await this.prisma.shop.findFirst({
      where: { id: claim.shopId, deletedAt: null },
      select: { id: true, outstandingDuesPaise: true, creditLimitPaise: true, isOpen: true },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    const now = new Date();
    await this.prisma.$transaction([
      // Flip ACCRUED entries to PAID
      this.prisma.ledgerEntry.updateMany({
        where: { shopId: claim.shopId, status: 'ACCRUED' },
        data: { status: 'PAID' },
      }),
      // Write a signed-negative PAYMENT ledger line for the exact claimed amount
      this.prisma.ledgerEntry.create({
        data: {
          shopId: claim.shopId,
          type: LedgerEntryType.PAYMENT,
          basePaise: -claim.amountPaise,
          gstPaise: 0,
          totalPaise: -claim.amountPaise,
          status: 'PAID',
        },
      }),
      // Decrement dues by the exact claimed amount
      this.prisma.shop.update({
        where: { id: claim.shopId },
        data: { outstandingDuesPaise: { decrement: claim.amountPaise } },
      }),
      // Mark claim approved
      this.prisma.paymentClaim.update({
        where: { id: claim.id },
        data: { status: 'APPROVED', clearedAt: now, clearedById: adminId },
      }),
    ]);

    // Reactivate if dues now under limit (re-read after transaction)
    const updated = await this.prisma.shop.findFirst({
      where: { id: claim.shopId },
      select: { outstandingDuesPaise: true, creditLimitPaise: true, isOpen: true },
    });
    if (updated && !updated.isOpen && updated.outstandingDuesPaise < updated.creditLimitPaise) {
      await this.prisma.shop.update({ where: { id: claim.shopId }, data: { isOpen: true } });
    }
  }

  private async approveRiderClaim(claim: { id: string; riderUserId: string | null; amountPaise: number }, adminId: string) {
    if (!claim.riderUserId) throw new BadRequestException('Claim has no riderUserId');
    const profile = await this.prisma.riderProfile.findFirst({ where: { userId: claim.riderUserId }, select: { duesPaise: true } });
    if (!profile) throw new NotFoundException('Rider profile not found');

    const newDues = Math.max(0, profile.duesPaise - claim.amountPaise);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.riderProfile.update({
        where: { userId: claim.riderUserId },
        data: { duesPaise: newDues },
      }),
      this.prisma.paymentClaim.update({
        where: { id: claim.id },
        data: { status: 'APPROVED', clearedAt: now, clearedById: adminId },
      }),
      // Rider ledger: COD deposit reduces the rider's dues (audit trail).
      this.prisma.riderLedger.create({
        data: {
          riderUserId: claim.riderUserId,
          type: RiderLedgerType.COD_DEPOSIT,
          amountPaise: -claim.amountPaise,
          note: 'COD cash deposited to NearBaz',
        },
      }),
    ]);
  }
}
