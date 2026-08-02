import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PaymentClaimsModule } from '../payment-claims/payment-claims.module';
import { DisputesModule } from '../disputes/disputes.module';
import { RidersModule } from '../riders/riders.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [PaymentClaimsModule, DisputesModule, RidersModule, LedgerModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
