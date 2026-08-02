import { Module } from '@nestjs/common';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';
import { AuthModule } from '../auth/auth.module';

/**
 * ShopsModule — shop registration/profile/KYC + customer discovery.
 * Imports AuthModule to re-issue a shop-scoped token when a shop is registered.
 */
@Module({
  imports: [AuthModule],
  controllers: [ShopsController],
  providers: [ShopsService],
  exports: [ShopsService],
})
export class ShopsModule {}
