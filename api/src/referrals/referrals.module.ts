import { Module } from '@nestjs/common';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

/** ReferralsModule — PassWaala Coins referral program. Exported so orders can
 * qualify a referral when the referee's 1st order is delivered. */
@Module({
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
