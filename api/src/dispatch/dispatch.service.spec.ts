import { Test } from '@nestjs/testing';
import { NotImplementedException } from '@nestjs/common';
import { DispatchService, DispatchRequest } from './dispatch.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * DispatchService smoke test — DB-free. The engine is an interface boundary for
 * the MVP; this proves it instantiates and its deferred methods report 501 so
 * the seam is real and callable in later phases.
 */
describe('DispatchService', () => {
  let service: DispatchService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DispatchService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(DispatchService);
  });

  it('instantiates', () => {
    expect(service).toBeDefined();
  });

  it('findCandidates is deferred (throws 501)', () => {
    const req: DispatchRequest = {
      capability: 'RIDER',
      destination: { latitude: 28.6, longitude: 77.2 },
      maxRadiusMeters: 3000,
    };
    expect(() => service.findCandidates(req)).toThrow(NotImplementedException);
  });
});
