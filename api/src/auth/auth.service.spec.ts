import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@nearbaz/shared';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AuthService unit tests — DB-free (Prisma mocked, no SMS). Proves the OTP + JWT
 * wiring and the hard security rules: the role is always server-assigned
 * CUSTOMER for a new user, and production login requires a verified phone
 * (MSG91 widget token), while dev bypasses SMS entirely.
 *
 * NOTE: production OTP verification is delegated to MSG91 (verifyMsg91Token),
 * NOT the in-memory otpStore — the store is a dev-only convenience. These tests
 * therefore stub verifyMsg91Token to exercise the real production security path.
 */
describe('AuthService', () => {
  let service: AuthService;
  let jwt: JwtService;

  // Mock Prisma: upsert returns a CUSTOMER user with no owned shops; update is
  // used to backfill the referral code / shortId; findUnique (OWNER lookup for
  // the ADMIN namespace) returns null so appType is not remapped.
  const prismaMock = {
    user: {
      upsert: jest.fn(async () => ({
        id: 'user-1',
        role: UserRole.CUSTOMER,
        referralCode: null,
        shortId: 'C12345678',
        ownedShops: [] as { id: string }[],
      })),
      update: jest.fn(async () => ({ id: 'user-1' })),
      findUnique: jest.fn(async () => null),
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

  /** Stub the MSG91 widget-token verification to a fixed outcome. */
  function stubMsg91(ok: boolean): void {
    jest
      .spyOn(service as unknown as { verifyMsg91Token: (t: string) => Promise<boolean> }, 'verifyMsg91Token')
      .mockResolvedValue(ok);
  }

  it('issues a token on the happy path (dev) and forces role=CUSTOMER', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development'; // dev: SMS bypassed
    try {
      const result = await service.verifyOtp('+919876543210', 'CUSTOMER');

      expect(result.role).toBe(UserRole.CUSTOMER);
      expect(typeof result.accessToken).toBe('string');

      // Decode the token: role must be CUSTOMER, never ADMIN/OWNER.
      const payload = jwt.verify<{ sub: string; role: UserRole }>(result.accessToken);
      expect(payload.role).toBe(UserRole.CUSTOMER);
      expect(payload.role).not.toBe(UserRole.ADMIN);
      expect(payload.role).not.toBe(UserRole.OWNER);
      expect(payload.sub).toBe('user-1');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('production: rejects login when no phone-verification token is supplied', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(service.verifyOtp('+919000000000', 'CUSTOMER')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('production: rejects an invalid/expired phone-verification token', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    stubMsg91(false); // MSG91 says the token is bad/expired
    try {
      await expect(
        service.verifyOtp('+919876543210', 'CUSTOMER', 'bad-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('production: issues a token when the phone-verification token is valid', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    stubMsg91(true); // MSG91 confirms ownership
    try {
      const result = await service.verifyOtp('+919876543210', 'CUSTOMER', 'good-token');
      expect(result.role).toBe(UserRole.CUSTOMER);
      expect(typeof result.accessToken).toBe('string');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('DEV bypass: outside production, any code logs in (no request-otp needed)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const result = await service.verifyOtp('+919000001111', 'CUSTOMER', undefined, '000000');
      expect(result.role).toBe(UserRole.CUSTOMER);
      expect(typeof result.accessToken).toBe('string');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
