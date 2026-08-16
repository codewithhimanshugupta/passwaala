import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { OrderStatus } from '@nearbaz/shared';
import {
  RealtimeGateway,
  customerRoom,
  shopRoom,
} from './realtime.gateway';

/**
 * RealtimeGateway unit test — DB-free, no real socket server. Injects a mock
 * Socket.IO server and asserts events are emitted to the correct (isolated)
 * shop/customer rooms — the anti-cross-tenant-leak contract.
 */
describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let emit: jest.Mock;
  let to: jest.Mock;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        // The gateway authenticates handshakes with JwtService; a mock suffices
        // for these emit-routing tests (no real socket connects here).
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
      ],
    }).compile();

    gateway = moduleRef.get(RealtimeGateway);

    emit = jest.fn();
    to = jest.fn().mockReturnValue({ emit });
    // Inject a mock server exposing .to(room).emit(event, payload).
    gateway.server = { to } as unknown as RealtimeGateway['server'];
  });

  it('emits order.created to the shop room', () => {
    gateway.emitOrderCreated('shop-1', { orderId: 'o-1' });
    expect(to).toHaveBeenCalledWith(shopRoom('shop-1'));
    expect(emit).toHaveBeenCalledWith('order.created', { orderId: 'o-1' });
  });

  it('emits order.statusChanged to the customer room', () => {
    gateway.emitOrderStatusChanged('cust-1', {
      orderId: 'o-1',
      status: OrderStatus.ACCEPTED,
    });
    expect(to).toHaveBeenCalledWith(customerRoom('cust-1'));
    expect(emit).toHaveBeenCalledWith('order.statusChanged', {
      orderId: 'o-1',
      status: OrderStatus.ACCEPTED,
    });
  });
});
