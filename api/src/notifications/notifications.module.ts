import { Module } from '@nestjs/common';
import { LogNotificationChannel } from './notification-channel.interface';
import {
  NOTIFICATION_CHANNELS,
  NotificationsService,
} from './notifications.service';

/**
 * NotificationsModule — the swappable notification seam (FCM/SMS/WhatsApp).
 *
 * Phase 0 registers a single no-op LogNotificationChannel behind the
 * NOTIFICATION_CHANNELS token; Phase 1 swaps in real channels (and durable
 * BullMQ delivery) with no change to callers. Exported so orders/realtime can
 * inject NotificationsService.
 */
@Module({
  providers: [
    LogNotificationChannel,
    {
      provide: NOTIFICATION_CHANNELS,
      useFactory: (log: LogNotificationChannel) => [log],
      inject: [LogNotificationChannel],
    },
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
