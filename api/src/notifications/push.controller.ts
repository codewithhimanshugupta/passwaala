import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { AuthPayload } from '../auth/auth-payload';
import { WebPushService } from './web-push.service';
import { ExpoPushService } from './expo-push.service';

/**
 * PushController — lets a signed-in user register/unregister their browser for
 * Web Push notifications, and exposes the public VAPID key the client needs to
 * subscribe. Any authenticated role may subscribe (shopkeeper, rider, customer).
 */
@Controller('push')
export class PushController {
  constructor(
    private readonly webPush: WebPushService,
    private readonly expoPush: ExpoPushService,
  ) {}

  /** Public VAPID key — the client needs it to create a PushSubscription. */
  @Public()
  @Get('vapid-key')
  vapidKey(): { publicKey: string | null } {
    return { publicKey: process.env.VAPID_PUBLIC ?? null };
  }

  /** Register this browser's push subscription against the caller. */
  @Post('subscribe')
  async subscribe(
    @CurrentUser() user: AuthPayload,
    @Body() sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  ): Promise<{ ok: true }> {
    await this.webPush.subscribe(user.sub, sub);
    return { ok: true };
  }

  /** Remove a subscription (on logout). */
  @Post('unsubscribe')
  async unsubscribe(@Body() body: { endpoint: string }): Promise<{ ok: true }> {
    await this.webPush.unsubscribe(body.endpoint);
    return { ok: true };
  }

  /** Register this native install's Expo push token against the caller. */
  @Post('expo/register')
  async expoRegister(
    @CurrentUser() user: AuthPayload,
    @Body()
    body: { token: string; platform?: string; appType?: string; deviceId?: string },
  ): Promise<{ ok: true }> {
    await this.expoPush.registerToken(user.sub, body.token, {
      platform: body.platform,
      appType: body.appType,
      deviceId: body.deviceId,
    });
    return { ok: true };
  }

  /** Remove a native Expo push token (on logout). */
  @Post('expo/unregister')
  async expoUnregister(@Body() body: { token: string }): Promise<{ ok: true }> {
    await this.expoPush.unregisterToken(body.token);
    return { ok: true };
  }
}
