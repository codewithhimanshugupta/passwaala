import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '@passwaala/shared';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { LedgerService } from '../ledger/ledger.service';
import { ReferralsService } from '../referrals/referrals.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { DisputesService } from '../disputes/disputes.service';
import { WebPushService } from '../notifications/web-push.service';
import { CouponsService } from '../coupons/coupons.service';

/**
 * OrdersService unit tests — DB-free. Exercises the REAL transition guard
 * (delegating to the shared state machine). DB-backed placement + feed +
 * advance are covered by the orders e2e suite.
 */
describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: {} },
        { provide: RealtimeGateway, useValue: { emitOrderCreated: jest.fn(), emitOrderStatusChanged: jest.fn() } },
        { provide: LedgerService, useValue: { accrueOnDelivery: jest.fn() } },
        { provide: ReferralsService, useValue: { qualifyOnDelivery: jest.fn() } },
        { provide: DispatchService, useValue: { startForOrder: jest.fn(), offerNext: jest.fn(), tick: jest.fn() } },
        { provide: DisputesService, useValue: { openSystemDispute: jest.fn() } },
        { provide: WebPushService, useValue: { sendToUser: jest.fn() } },
        { provide: CouponsService, useValue: { validateForOrder: jest.fn(), redeem: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(OrdersService);
  });

  it('allows a legal transition (PLACED -> ACCEPTED)', () => {
    expect(service.assertTransition(OrderStatus.PLACED, OrderStatus.ACCEPTED)).toBe(
      OrderStatus.ACCEPTED,
    );
  });

  it('rejects an illegal transition (DELIVERED -> PLACED)', () => {
    expect(() =>
      service.assertTransition(OrderStatus.DELIVERED, OrderStatus.PLACED),
    ).toThrow(BadRequestException);
  });
});
