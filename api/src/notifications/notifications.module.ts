import { Module } from '@nestjs/common';
import { LogNotificationChannel } from './notification-channel.interface';
import {
  NOTIFICATION_CHANNELS,
  NotificationsService,
} from './notifications.service';
import { WebPushService } from './web-push.service';
import { PushController } from './push.controller';

/**
 * NotificationsModule — the swappable notification seam (FCM/SMS/WhatsApp) plus
 * Web Push (VAPID) for backgrounded/locked-phone alerts.
 *
 * Phase 0 registers a single no-op LogNotificationChannel behind the
 * NOTIFICATION_CHANNELS token; Phase 1 swaps in real channels (and durable
 * BullMQ delivery) with no change to callers. WebPushService is exported so
 * orders/realtime can push order events to subscribed devices.
 */
@Module({
  controllers: [PushController],
  providers: [
    LogNotificationChannel,
    {
      provide: NOTIFICATION_CHANNELS,
      useFactory: (log: LogNotificationChannel) => [log],
      inject: [LogNotificationChannel],
    },
    NotificationsService,
    WebPushService,
  ],
  exports: [NotificationsService, WebPushService],
})
export class NotificationsModule {}
