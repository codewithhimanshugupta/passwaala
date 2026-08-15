import { Injectable, Logger } from '@nestjs/common';
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ExpoPushService — sends OS push notifications to a user's NATIVE app installs
 * (iOS/Android) via the Expo Push API. This is the native-app counterpart to
 * WebPushService (which handles browser/PWA VAPID push). Tokens are stored per
 * install (ExpoPushToken table); a DeviceNotRegistered receipt means the token
 * is dead — we prune it.
 *
 * Always enabled (Expo's push endpoint needs no server key for basic sends);
 * still best-effort: failures are logged and never thrown to the caller, so a
 * push problem can never break the business event that triggered it.
 */
@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);
  private readonly expo = new Expo(
    process.env.EXPO_ACCESS_TOKEN
      ? { accessToken: process.env.EXPO_ACCESS_TOKEN }
      : undefined,
  );

  constructor(private readonly prisma: PrismaService) {}

  /** Store (upsert) a native push token for a user. Validates the token shape. */
  async registerToken(
    userId: string,
    token: string,
    meta?: { platform?: string; appType?: string; deviceId?: string },
  ): Promise<void> {
    if (!Expo.isExpoPushToken(token)) {
      this.logger.warn(`ignoring invalid Expo push token for user ${userId}`);
      return;
    }
    await this.prisma.expoPushToken.upsert({
      where: { token },
      create: {
        userId,
        token,
        platform: meta?.platform,
        appType: meta?.appType,
        deviceId: meta?.deviceId,
      },
      // Re-point an existing token to whoever is logged in now (shared device).
      update: {
        userId,
        platform: meta?.platform,
        appType: meta?.appType,
        deviceId: meta?.deviceId,
      },
    });
  }

  /** Remove a token (on logout or when the client unregisters). */
  async unregisterToken(token: string): Promise<void> {
    await this.prisma.expoPushToken.deleteMany({ where: { token } });
  }

  /**
   * Send a push to every native install of a user. Best-effort: chunked,
   * failures logged, dead tokens (DeviceNotRegistered) pruned. Never throws.
   * `url` and `tag` ride along in `data` so the app can deep-link on tap.
   */
  async sendToUser(
    userId: string,
    payload: { title: string; body: string; tag?: string; url?: string },
  ): Promise<void> {
    let tokens: string[];
    try {
      const rows = await this.prisma.expoPushToken.findMany({
        where: { userId },
        select: { token: true },
      });
      tokens = rows.map((r) => r.token).filter((t) => Expo.isExpoPushToken(t));
    } catch (e) {
      this.logger.warn(`expo token lookup failed: ${(e as Error).message}`);
      return;
    }
    if (!tokens.length) return;

    const messages: ExpoPushMessage[] = tokens.map((to) => ({
      to,
      title: payload.title,
      body: payload.body,
      sound: 'default',
      priority: 'high',
      channelId: 'default',
      data: { url: payload.url, tag: payload.tag },
    }));

    const chunks = this.expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      let tickets: ExpoPushTicket[];
      try {
        tickets = await this.expo.sendPushNotificationsAsync(chunk);
      } catch (e) {
        this.logger.warn(`expo push send failed: ${(e as Error).message}`);
        continue;
      }
      // Prune tokens Expo reports as no longer registered.
      await Promise.all(
        tickets.map(async (ticket, i) => {
          if (
            ticket.status === 'error' &&
            ticket.details?.error === 'DeviceNotRegistered'
          ) {
            const dead = (chunk[i].to as string) ?? '';
            if (dead) {
              await this.prisma.expoPushToken
                .deleteMany({ where: { token: dead } })
                .catch(() => undefined);
            }
          }
        }),
      );
    }
  }
}
