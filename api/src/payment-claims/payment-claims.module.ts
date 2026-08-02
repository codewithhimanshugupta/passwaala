import { Module } from '@nestjs/common';
import { PaymentClaimsService } from './payment-claims.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PaymentClaimsService],
  exports: [PaymentClaimsService],
})
export class PaymentClaimsModule {}
