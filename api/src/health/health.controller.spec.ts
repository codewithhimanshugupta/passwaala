import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus, canTransition, computeGst } from '@nearbaz/shared';

/**
 * Added by the Phase 0 verifier. This spec has NO database dependency — it
 * proves the API can instantiate a Nest controller and consume @nearbaz/shared
 * at runtime (not just at type level). DB-backed integration tests are PENDING
 * (Docker/Postgres unavailable in Phase 0).
 */
describe('HealthController', () => {
  let controller: HealthController;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      // check() is synchronous and doesn't touch the DB; the warm-ping path uses
      // prisma only in the async DB check, so a mock provider is enough here.
      providers: [{ provide: PrismaService, useValue: { $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } }],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('returns ok', async () => {
    expect((await controller.check()).status).toBe('ok');
  });

  it('uses shared order-state-machine', async () => {
    expect((await controller.check()).sampleTransitionOk).toBe(true);
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.PLACED)).toBe(false);
  });

  it('uses shared money helper (18% GST)', () => {
    // ₹100 base = 10000 paise -> 1800 paise GST -> 11800 total.
    expect(computeGst(10000)).toEqual({
      basePaise: 10000,
      gstPaise: 1800,
      totalPaise: 11800,
    });
  });
});
