import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AutomationService } from './automation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { DisputesModule } from '../disputes/disputes.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, RealtimeModule, DisputesModule],
  providers: [AutomationService],
})
export class AutomationModule {}
