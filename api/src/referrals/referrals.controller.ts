import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPayload } from '../auth/auth-payload';
import { ReferralsService } from './referrals.service';

/**
 * ReferralsController — the caller's referral code + coins, and applying a code.
 * Open to any authenticated user (customer surface).
 */
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  /** My referral code, coin balance, and referrals I've made. */
  @Get('me')
  me(@CurrentUser() user: AuthPayload) {
    return this.referrals.me(user.sub);
  }

  /** Apply someone's referral code (I'm the new referee). */
  @Post('apply')
  apply(@CurrentUser() user: AuthPayload, @Body('code') code: string) {
    return this.referrals.apply(user.sub, code);
  }
}
