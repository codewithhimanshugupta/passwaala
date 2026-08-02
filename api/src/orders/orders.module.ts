import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { DisputesModule } from '../disputes/disputes.module';

/**
 * OrdersModule — order placement + lifecycle transitions.
 * Imports RealtimeModule (live events), LedgerModule (commission/fee accrual on
 * DELIVERED + credit-limit auto-pause), ReferralsModule (qualify a referral
 * when the referee's 1st order is delivered), DispatchModule (offer a
 * PLATFORM_RIDER order to nearby riders once it's READY), and DisputesModule
 * (auto-open a review dispute when an order is cancelled / refund-pending).
 */
@Module({
  imports: [RealtimeModule, LedgerModule, ReferralsModule, DispatchModule, DisputesModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
