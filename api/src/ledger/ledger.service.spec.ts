import { Test } from '@nestjs/testing';
import { LedgerEntryType } from '@nearbaz/shared';
import { LedgerService } from './ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { CitiesService } from '../cities/cities.service';

/**
 * LedgerService unit tests — DB-free. Verifies the REAL money math: 18% GST on
 * a debit line, and correctly signed-negative credit lines. (₹100 commission =
 * 10000 paise base -> 1800 GST -> 11800 total owed.)
 */
describe('LedgerService', () => {
  let service: LedgerService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LedgerService,
        { provide: PrismaService, useValue: {} },
        { provide: CitiesService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(LedgerService);
  });

  it('applies 18% GST on a debit line (owed to NearBaz)', () => {
    const line = service.buildDebitLine(LedgerEntryType.COMMISSION, 10000);
    expect(line).toEqual({
      type: LedgerEntryType.COMMISSION,
      basePaise: 10000,
      gstPaise: 1800,
      totalPaise: 11800,
    });
  });

  it('signs a credit line negative (reduces dues)', () => {
    const line = service.buildCreditLine(LedgerEntryType.REFERRAL_CREDIT, 10000);
    expect(line.totalPaise).toBe(-11800);
    expect(line.basePaise).toBe(-10000);
    expect(line.gstPaise).toBe(-1800);
  });
});
