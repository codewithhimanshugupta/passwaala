import { Module } from '@nestjs/common';
import { DisputesService } from './disputes.service';
import { DisputesController, AdminDisputesController } from './disputes.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DisputesController, AdminDisputesController],
  providers: [DisputesService],
  exports: [DisputesService],
})
export class DisputesModule {}
