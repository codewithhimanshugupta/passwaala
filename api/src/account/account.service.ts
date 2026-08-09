import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { titleCaseName } from '../common/text.util';

/**
 * AccountService — profile + in-app account deletion (plan → Compliance: account
 * deletion is a hard app-store gate).
 *
 * Deletion ANONYMIZES PII and soft-deletes the user, but RETAINS order/ledger
 * history (legally + financially required — losing a ledger row loses money
 * owed). The phone is scrambled so it frees up for re-signup and can't identify
 * the person, and the name is cleared.
 */
@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's own profile (safe fields only). */
  async me(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, phone: true, name: true, role: true, coinBalance: true, pendingCancelFeePaise: true },
    });
    if (!user) {
      throw new NotFoundException('Account not found');
    }
    return user;
  }

  /** Update the caller's display name. */
  async updateName(userId: string, name: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { name: titleCaseName(name) } });
    return this.me(userId);
  }

  /**
   * Delete the caller's account: anonymize PII + soft-delete, retaining order/
   * ledger history. Idempotent-ish (a deleted user is simply gone from `me`).
   */
  async deleteMe(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('Account not found');
    }
    // Scramble the phone so it no longer identifies the person and frees the
    // number for future re-signup. Keep it unique to satisfy the DB constraint.
    const anonymizedPhone = `deleted:${userId}`;
    await this.prisma.user.update({
      where: { id: userId },
      data: { phone: anonymizedPhone, name: null, deletedAt: new Date() },
    });
    return { deleted: true };
  }
}
