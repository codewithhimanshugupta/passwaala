import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

/**
 * WebPushService — sends Web Push (VAPID) notifications to a user's subscribed
 * browsers/PWAs so they're alerted when the app is backgrounded or the phone is
 * locked. Subscriptions are stored per user (PushSubscription table). A 404/410
 * from the push service means the subscription is dead — we prune it.
 *
 * Requires env: VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT (mailto: or https URL).
 * If keys are absent the service is a no-op (logs once) so dev/test still boots.
 */
@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);
  private enabled = false;

  constructor(private readonly prisma: PrismaService) {
    const pub = process.env.VAPID_PUBLIC;
    const priv = process.env.VAPID_PRIVATE;
    const subject = process.env.VAPID_SUBJECT || 'mailto:support@passwaala.in';
    if (pub && priv) {
      webpush.setVapidDetails(subject, pub, priv);
      this.enabled = true;
    } else {
      this.logger.warn('VAPID keys not set — web push disabled (no-op).');
    }
  }

  /** Store (upsert) a browser push subscription for a user. */
  async subscribe(
    userId: string,
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  ): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  }

  /** Remove a subscription (on logout or unsubscribe). */
  async unsubscribe(endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
  }

  /**
   * Send a push to every device of a user. Best-effort: failures are logged,
   * and dead subscriptions (404/410) are pruned. Never throws to the caller.
   */
  async sendToUser(
    userId: string,
    payload: { title: string; body: string; tag?: string; url?: string },
  ): Promise<void> {
    if (!this.enabled) return;
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (!subs.length) return;
    const data = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            data,
          );
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await this.prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } });
          } else {
            this.logger.warn(`push send failed: ${(e as Error).message}`);
          }
        }
      }),
    );
  }
}
