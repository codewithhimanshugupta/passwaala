import { Injectable, Logger } from '@nestjs/common';

/**
 * A single out-of-app notification to send (order lifecycle event, OTP, etc.).
 * Copy is short, includes order id + shop name + amount (plan → Notifications).
 */
export interface NotificationMessage {
  /** Recipient phone in E.164-ish form (SMS/WhatsApp) or device token (FCM). */
  to: string;
  /** Template/event key (e.g. 'order.placed', 'otp'). */
  template: string;
  /** Template variables (order id, shop name, amount, ...). */
  params: Record<string, string | number>;
}

/**
 * NotificationChannel — the swappable seam that keeps launch from waiting on
 * WhatsApp/Meta approval (plan → Known Risks #1). FCM + SMS are the primary
 * path; WhatsApp switches on later via config with no rework.
 *
 * Any concrete channel (FCM, SMS/MSG91, WhatsApp Cloud API) implements this;
 * callers depend only on the interface.
 */
export interface NotificationChannel {
  /** Stable channel name for logging/metrics ('fcm' | 'sms' | 'whatsapp'). */
  readonly name: string;
  /** Whether this channel is currently enabled (config-gated). */
  isEnabled(): boolean;
  /** Send a message. Phase 1+ wires real providers with retries via BullMQ. */
  send(message: NotificationMessage): Promise<void>;
}

/**
 * Phase-0 no-op channel — logs instead of sending. Proves the seam compiles and
 * lets order-flow code call notifications without a live provider. Real FCM/SMS/
 * WhatsApp channels replace this in Phase 1 (behind the same interface), and
 * sends move off the request path onto the durable BullMQ queue.
 */
@Injectable()
export class LogNotificationChannel implements NotificationChannel {
  readonly name = 'log';
  private readonly logger = new Logger(LogNotificationChannel.name);

  isEnabled(): boolean {
    return true;
  }

  async send(message: NotificationMessage): Promise<void> {
    // Never log OTP codes / PII values in production (plan → Security).
    this.logger.debug(
      `[notify:${this.name}] template=${message.template} to=${message.to}`,
    );
  }
}
