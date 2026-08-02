import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@passwaala/shared';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AuthService unit tests — DB-free (Prisma mocked, no SMS). Proves the OTP + JWT
 * wiring and the hard security rules: the role is always server-assigned
 * CUSTOMER for a new user, and bad/expired OTPs are rejected.
 */
describe('AuthService', () => {
  let service: AuthService;
  let jwt: JwtService;

  // Mock Prisma: upsert returns a CUSTOMER user with no owned shops; update is
  // used to backfill the referral code.
  const prismaMock = {
    user: {
      upsert: jest.fn(async () => ({
        id: 'user-1',
        role: UserRole.CUSTOMER,
        referralCode: null,
        ownedShops: [] as { id: string }[],
      })),
      update: jest.fn(async () => ({ id: 'user-1' })),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: 'test-secret', signOptions: { expiresIn: '15m' } }),
      ],
      providers: [AuthService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = moduleRef.get(AuthService);
    jwt = moduleRef.get(JwtService);
  });

  it('issues a token on the happy path and forces role=CUSTOMER', async () => {
    service.requestOtp('+919876543210');
    // Reach into the store to learn the generated code (test-only).
    const code = (service as unknown as {
      otpStore: Map<string, { code: string; expiresAt: number }>;
    }).otpStore.get('+919876543210')!.code;

    const result = await service.verifyOtp('+919876543210', code);

    expect(result.role).toBe(UserRole.CUSTOMER);
    expect(typeof result.accessToken).toBe('string');

    // Decode the token: role must be CUSTOMER, never ADMIN/OWNER.
    const payload = jwt.verify<{ sub: string; role: UserRole }>(result.accessToken);
    expect(payload.role).toBe(UserRole.CUSTOMER);
    expect(payload.role).not.toBe(UserRole.ADMIN);
    expect(payload.role).not.toBe(UserRole.OWNER);
    expect(payload.sub).toBe('user-1');
  });

  it('rejects verification when no OTP was requested', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // exercise the real security path
    try {
      await expect(service.verifyOtp('+919000000000', '123456')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('rejects a wrong OTP code', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      service.requestOtp('+919876543210');
      await expect(service.verifyOtp('+919876543210', '000000')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('rejects an expired OTP', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      service.requestOtp('+919876543210');
      const entry = (service as unknown as {
        otpStore: Map<string, { code: string; expiresAt: number }>;
      }).otpStore.get('+919876543210')!;
      // Force expiry into the past.
      entry.expiresAt = Date.now() - 1;

      await expect(service.verifyOtp('+919876543210', entry.code)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('consumes the OTP (single-use) — a second verify fails', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      service.requestOtp('+919876543210');
      const code = (service as unknown as {
        otpStore: Map<string, { code: string; expiresAt: number }>;
      }).otpStore.get('+919876543210')!.code;

      await service.verifyOtp('+919876543210', code);
      await expect(service.verifyOtp('+919876543210', code)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('DEV bypass: outside production, any code logs in (no request-otp needed)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const result = await service.verifyOtp('+919000001111', '000000');
      expect(result.role).toBe(UserRole.CUSTOMER);
      expect(typeof result.accessToken).toBe('string');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
