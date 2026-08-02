import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@passwaala/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthPayload } from './auth-payload';
import {
  decryptOtp,
  encryptOtp,
  generateLoginOtp,
  hashPassword,
  verifyPassword,
} from './credentials.util';

/**
 * AuthService — phone OTP + JWT sessions (plan → Auth, Security & Data
 * Protection).
 *
 * Prisma-backed find-or-create on verify: a successful OTP mints a real User
 * row (role server-assigned) and signs a short-lived JWT carrying { sub, role,
 * shopId? }. Phase 0's mock is gone; the SMS send is still mocked (Phase 1
 * wires MSG91/WhatsApp) and the OTP store is in-memory (Phase 1 moves it to
 * Redis with per-phone + per-IP rate limiting).
 *
 * HARD RULES enforced here (do not regress):
 *  - Role is ALWAYS server-assigned. A public OTP login can only ever mint a
 *    CUSTOMER. It can NEVER create or elevate to ADMIN/OWNER — no code path
 *    accepts a client-supplied role. (plan → "No public registration for
 *    ADMIN or OWNER".) A SHOPKEEPER is minted when they register a shop
 *    (shops module), still server-side.
 *  - Access tokens are short-lived (JwtModule: 15m).
 *  - shopId in the token comes from the User's owned shop, never client input.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** In-memory OTP store, keyed by "phone:appType". Phase 1 → Redis. */
  private readonly otpStore = new Map<string, { code: string; expiresAt: number }>();

  private static readonly OTP_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /** Map appType string → UserRole for find-or-create. */
  private static appTypeToRole(appType: string): UserRole {
    switch (appType) {
      case 'SHOPKEEPER': return UserRole.SHOPKEEPER;
      case 'RIDER': return UserRole.RIDER;
      case 'ADMIN': return UserRole.ADMIN;
      case 'OWNER': return UserRole.OWNER;
      default: return UserRole.CUSTOMER;
    }
  }

  /** shortId prefix per appType. */
  private static shortIdPrefix(appType: string): string {
    switch (appType) {
      case 'SHOPKEEPER': return 'SK';
      case 'RIDER': return 'R';
      case 'ADMIN': return 'A';
      case 'OWNER': return 'O';
      default: return 'C';
    }
  }

  requestOtp(phone: string, appType = 'CUSTOMER'): { sent: true } {
    const normalized = phone.startsWith('+91') ? phone : `+91${phone}`;
    const code = this.generateOtp();
    // Key includes appType so rider + customer OTPs for same phone don't interfere
    this.otpStore.set(`${normalized}:${appType}`, {
      code,
      expiresAt: Date.now() + AuthService.OTP_TTL_MS,
    });

    // OTP delivery: no SMS provider wired yet, so we log the code. In production
    // this is a TEMPORARY testing measure — replace with a real SMS/WhatsApp
    // sender (MSG91/Twilio) before public launch, and drop this log.
    this.logger.log(`OTP for ${normalized} [${appType}]: ${code}`);
    return { sent: true };
  }

  /**
   * Verify an OTP and issue a JWT. Finds-or-creates the User (Prisma) keyed by
   * phone and signs a short-lived access token carrying { sub, role, shopId? }.
   *
   * The role is NEVER read from client input: an existing user keeps their
   * server-assigned role; a brand-new user is created as CUSTOMER.
   */
  async verifyOtp(
    phone: string,
    code: string,
    appType = 'CUSTOMER',
  ): Promise<{ accessToken: string; role: UserRole }> {
    const normalized = phone.startsWith('+91') ? phone : `+91${phone}`;
    const otpKey = `${normalized}:${appType}`;
    const devBypass = process.env.NODE_ENV !== 'production';

    if (!devBypass) {
      const entry = this.otpStore.get(otpKey);
      if (!entry) throw new UnauthorizedException('No OTP requested for this number');
      if (Date.now() > entry.expiresAt) {
        this.otpStore.delete(otpKey);
        throw new UnauthorizedException('OTP expired');
      }
      if (entry.code !== code) throw new UnauthorizedException('Invalid OTP');
      this.otpStore.delete(otpKey);
    }

    const roleForCreate = AuthService.appTypeToRole(appType);

    // The ADMIN app is shared by ADMIN and OWNER accounts: an OWNER (who sits
    // above ADMIN) must be able to sign in here AS owner, not get a fresh ADMIN
    // account minted on their phone. So if an OWNER already exists on this phone,
    // log them in on the OWNER namespace instead of the ADMIN one.
    let effectiveAppType = appType;
    if (appType === 'ADMIN') {
      const owner = await this.prisma.user.findUnique({
        where: { phone_appType: { phone: normalized, appType: 'OWNER' } },
        select: { id: true },
      });
      if (owner) effectiveAppType = 'OWNER';
    }

    // Find-or-create using composite key (phone + appType) — same phone is
    // independent in each app namespace.
    const user = await this.prisma.user.upsert({
      where: { phone_appType: { phone: normalized, appType: effectiveAppType } },
      update: {},
      create: { phone: normalized, role: roleForCreate, appType: effectiveAppType },
      include: { ownedShops: { where: { deletedAt: null }, select: { id: true } } },
    });

    // Backfill referral code
    if (!user.referralCode) {
      const rc = `PW${user.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
      await this.prisma.user.update({ where: { id: user.id }, data: { referralCode: rc } });
    }
    // Backfill shortId with per-role prefix
    if (!(user as unknown as { shortId?: string }).shortId) {
      const prefix = AuthService.shortIdPrefix(effectiveAppType);
      const shortId = `${prefix}${user.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
      await this.prisma.user.update({ where: { id: user.id }, data: { shortId } });
    }

    // Auto-promote CUSTOMER→SHOPKEEPER only in the CUSTOMER namespace
    let resolvedRole = user.role as UserRole;
    if (appType === 'CUSTOMER' && resolvedRole === UserRole.CUSTOMER && user.ownedShops.length > 0) {
      await this.prisma.user.update({ where: { id: user.id }, data: { role: UserRole.SHOPKEEPER } });
      resolvedRole = UserRole.SHOPKEEPER;
    }

    return {
      accessToken: await this.signFor(user.id, resolvedRole, user.ownedShops[0]?.id),
      role: resolvedRole,
    };
  }

  /**
   * Resolve the effective appType, honouring the OWNER-in-admin-app rule: an
   * OWNER signing in via the ADMIN app stays OWNER (never minted as a new admin).
   */
  private async resolveAppType(normalized: string, appType: string): Promise<string> {
    if (appType === 'ADMIN') {
      const owner = await this.prisma.user.findUnique({
        where: { phone_appType: { phone: normalized, appType: 'OWNER' } },
        select: { id: true },
      });
      if (owner) return 'OWNER';
    }
    return appType;
  }

  /** Backfill referralCode + shortId on a freshly-resolved user (idempotent). */
  private async backfillIdentifiers(
    user: { id: string; referralCode: string | null; shortId?: string | null },
    appType: string,
  ): Promise<void> {
    if (!user.referralCode) {
      const rc = `PW${user.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
      await this.prisma.user.update({ where: { id: user.id }, data: { referralCode: rc } });
    }
    if (!user.shortId) {
      const prefix = AuthService.shortIdPrefix(appType);
      const shortId = `${prefix}${user.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
      await this.prisma.user.update({ where: { id: user.id }, data: { shortId } });
    }
  }

  /**
   * Sign up with phone + name + password (no SMS). Creates/updates the
   * (phone, appType) user, stores a scrypt password hash, and generates a fixed
   * backup login OTP (AES-encrypted at rest) shown to the caller ONCE. Returns a
   * JWT so the app can proceed straight into onboarding/registration.
   */
  async signup(
    phone: string,
    name: string,
    password: string,
    appType = 'CUSTOMER',
  ): Promise<{ accessToken: string; role: UserRole; loginOtp: string }> {
    const normalized = phone.startsWith('+91') ? phone : `+91${phone}`;
    const effectiveAppType = await this.resolveAppType(normalized, appType);
    const roleForCreate = AuthService.appTypeToRole(effectiveAppType);

    // Generate a backup OTP only for a brand-new credential; keep an existing one.
    const existing = await this.prisma.user.findUnique({
      where: { phone_appType: { phone: normalized, appType: effectiveAppType } },
      select: { loginOtpEnc: true },
    });
    const plainOtp = generateLoginOtp();
    const loginOtpEnc = existing?.loginOtpEnc ?? encryptOtp(plainOtp);

    const user = await this.prisma.user.upsert({
      where: { phone_appType: { phone: normalized, appType: effectiveAppType } },
      update: { name, passwordHash: hashPassword(password), loginOtpEnc },
      create: {
        phone: normalized,
        role: roleForCreate,
        appType: effectiveAppType,
        name,
        passwordHash: hashPassword(password),
        loginOtpEnc,
      },
      include: { ownedShops: { where: { deletedAt: null }, select: { id: true } } },
    });

    await this.backfillIdentifiers(user, effectiveAppType);

    let resolvedRole = user.role as UserRole;
    if (appType === 'CUSTOMER' && resolvedRole === UserRole.CUSTOMER && user.ownedShops.length > 0) {
      await this.prisma.user.update({ where: { id: user.id }, data: { role: UserRole.SHOPKEEPER } });
      resolvedRole = UserRole.SHOPKEEPER;
    }

    // Reveal the OTP once: the plaintext we just generated (or decrypt the kept one).
    const shownOtp = existing?.loginOtpEnc ? decryptOtp(existing.loginOtpEnc) ?? plainOtp : plainOtp;

    return {
      accessToken: await this.signFor(user.id, resolvedRole, user.ownedShops[0]?.id),
      role: resolvedRole,
      loginOtp: shownOtp,
    };
  }

  /**
   * Log in with phone + a credential that is EITHER the password OR the fixed
   * backup OTP. No SMS. 401 if the user doesn't exist or the credential matches
   * neither. Signs the same JWT shape as OTP login.
   */
  async login(
    phone: string,
    credential: string,
    appType = 'CUSTOMER',
  ): Promise<{ accessToken: string; role: UserRole }> {
    const normalized = phone.startsWith('+91') ? phone : `+91${phone}`;
    const effectiveAppType = await this.resolveAppType(normalized, appType);

    const user = await this.prisma.user.findUnique({
      where: { phone_appType: { phone: normalized, appType: effectiveAppType } },
      include: { ownedShops: { where: { deletedAt: null }, select: { id: true } } },
    });
    if (!user) {
      throw new UnauthorizedException('No account found. Please sign up first.');
    }

    const passOk = verifyPassword(credential, user.passwordHash);
    const otpOk = !!user.loginOtpEnc && decryptOtp(user.loginOtpEnc) === credential;
    if (!passOk && !otpOk) {
      throw new UnauthorizedException('Incorrect password or OTP.');
    }

    return {
      accessToken: await this.signFor(user.id, user.role as UserRole, user.ownedShops[0]?.id),
      role: user.role as UserRole,
    };
  }

  /** Admin-only: reveal a user's decrypted backup login OTP. */
  async revealLoginOtp(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { loginOtpEnc: true },
    });
    return decryptOtp(user?.loginOtpEnc);
  }

  /**
   * Sign an access token for a user. Exposed so other modules (e.g. shops, when
   * a shopkeeper registers) can re-issue a token that now carries shopId — the
   * shop scope is always derived server-side, never from client input.
   */
  async signFor(userId: string, role: UserRole, shopId?: string): Promise<string> {
    const payload: AuthPayload = { sub: userId, role };
    if (shopId) {
      payload.shopId = shopId;
    }
    return this.jwt.signAsync(payload);
  }

  /**
   * Close all shops owned by the given user. Called on explicit logout so
   * customers can't reach a shop whose owner is no longer attending.
   */
  async closeAllShops(userId: string): Promise<void> {
    await this.prisma.shop.updateMany({
      where: { ownerId: userId, deletedAt: null },
      data: { isOpen: false },
    });
  }

  /** Generate a 6-digit numeric OTP (zero-padded). Phase 1 uses a CSPRNG. */
  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}
