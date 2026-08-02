import { Inject, Injectable } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationMessage,
} from './notification-channel.interface';

/** DI token for the ordered list of notification channels (FCM, SMS, WhatsApp). */
export const NOTIFICATION_CHANNELS = 'passwaala:notification-channels';

/**
 * NotificationsService — fans an event out over the configured channels
 * (plan → Notifications, Known Risks #1 & #3: defense in depth, never rely on
 * one channel).
 *
 * PHASE 0 SCOPE: dispatches to whatever channels are provided (a single no-op
 * LogNotificationChannel for now). Phase 1 registers real FCM + SMS (+ optional
 * WhatsApp) channels and moves the send onto the durable BullMQ queue with
 * retries + a dead-letter queue so a notification is never silently lost.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NOTIFICATION_CHANNELS)
    private readonly channels: NotificationChannel[],
  ) {}

  /**
   * Send a message over every enabled channel. Returns the channel names that
   * accepted it. Phase 1 makes this enqueue durable jobs instead of awaiting
   * inline on the request path.
   */
  async notify(message: NotificationMessage): Promise<string[]> {
    const used: string[] = [];
    for (const channel of this.channels) {
      if (channel.isEnabled()) {
        await channel.send(message);
        used.push(channel.name);
      }
    }
    return used;
  }
}
