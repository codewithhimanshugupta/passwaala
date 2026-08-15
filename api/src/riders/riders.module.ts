import { Module } from '@nestjs/common';
import { RidersController } from './riders.controller';
import { RidersService } from './riders.service';
import { AuthModule } from '../auth/auth.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PaymentClaimsModule } from '../payment-claims/payment-claims.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { NotificationsModule } from '../notifications/notifications.module';

/** RidersModule — platform delivery network (rider job board + earnings). */
@Module({
  imports: [AuthModule, DispatchModule, RealtimeModule, PaymentClaimsModule, LedgerModule, ReferralsModule, NotificationsModule],
  controllers: [RidersController],
  providers: [RidersService],
  exports: [RidersService],
})
export class RidersModule {}
