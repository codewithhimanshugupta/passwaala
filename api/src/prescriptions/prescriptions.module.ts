import { Module } from '@nestjs/common';
import { PrescriptionsService } from './prescriptions.service';
import { PrescriptionsController } from './prescriptions.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * PrescriptionsModule — medical-store prescription order flow. Imports
 * RealtimeModule (live shop/customer events) + NotificationsModule (WebPush).
 */
@Module({
  imports: [PrismaModule, RealtimeModule, NotificationsModule],
  controllers: [PrescriptionsController],
  providers: [PrescriptionsService],
  exports: [PrescriptionsService],
})
export class PrescriptionsModule {}
