import { Test } from '@nestjs/testing';
import { LogNotificationChannel } from './notification-channel.interface';
import {
  NOTIFICATION_CHANNELS,
  NotificationsService,
} from './notifications.service';

/**
 * NotificationsService unit test — DB-free. Proves the channel-fanout seam:
 * a message is dispatched over every enabled channel and the used channels are
 * reported back.
 */
describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LogNotificationChannel,
        {
          provide: NOTIFICATION_CHANNELS,
          useFactory: (log: LogNotificationChannel) => [log],
          inject: [LogNotificationChannel],
        },
        NotificationsService,
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  it('fans a message out over enabled channels', async () => {
    const used = await service.notify({
      to: '+919876543210',
      template: 'order.placed',
      params: { orderId: 'o-1', shopName: 'Test Kirana', amount: 12300 },
    });
    expect(used).toContain('log');
  });
});
