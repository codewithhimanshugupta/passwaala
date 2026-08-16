import { Module } from '@nestjs/common';
import { AdsService } from './ads.service';
import { AdsController, ShopAdsController, AdminAdsController } from './ads.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [PrismaModule, LedgerModule],
  controllers: [AdsController, ShopAdsController, AdminAdsController],
  providers: [AdsService],
  exports: [AdsService],
})
export class AdsModule {}
