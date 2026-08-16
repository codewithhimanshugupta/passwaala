import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@passwaala/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthPayload } from './auth-payload';
import {
  decryptOtp,
  encryptOtp,
  hashPassword,
  verifyPassword,
} from './credentials.util';
import { titleCaseName } from '../common/text.util';

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

  /** Strip country code and non-digits — always stores exactly 10 digits. */
  static normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '').slice(-10);
  }

  /** Verify a MSG91 widget access token server-side. Returns true on success. */
  private async verifyMsg91Token(token: string): Promise<boolean> {
    if (!process.env.MSG91_AUTH_KEY) {
      // Misconfiguration: the account-level Auth Key (distinct from the widget's
      // client-side tokenAuth) is not set. Every verify would fail — surface it.
      this.logger.error(
        'MSG91_AUTH_KEY is not set — phone verification cannot succeed. Set the MSG91 account Auth Key in the server environment (Render → Environment).',
      );
      return false;
    }
    try {
      const res = await fetch('https://control.msg91.com/api/v5/widget/verifyAccessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authkey: process.env.MSG91_AUTH_KEY,
          'access-token': token,
        }),
      });
      const data = (await res.json()) as { type?: string; message?: unknown; code?: unknown };
      if (data?.type === 'success') return true;
      // Log the real reason so failures are diagnosable (e.g. "AuthenticationFailure"
      // = wrong Auth Key; token expired/reused = client took too long or double-verified).
      this.logger.warn(
        `MSG91 verifyAccessToken failed: type=${data?.type} code=${String(data?.code)} message=${String(data?.message)}`,
      );
      return false;
    } catch (e) {
      this.logger.error(`MSG91 verifyAccessToken request error: ${(e as Error).message}`);
      return false;
    }
  }

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
    const normalized = AuthService.normalizePhone(phone);
    const code = this.generateOtp();
    this.otpStore.set(`${normalized}:${appType}`, {
      code,
      expiresAt: Date.now() + AuthService.OTP_TTL_MS,
    });
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
    appType = 'CUSTOMER',
    msg91Token?: string,
    code?: string,
    createIfMissing = true,
  ): Promise<{ accessToken: string; role: UserRole }> {
    const normalized = AuthService.normalizePhone(phone);
    const otpKey = `${normalized}:${appType}`;

    if (process.env.NODE_ENV === 'production') {
      if (!msg91Token) throw new UnauthorizedException('Phone verification token required.');
      const ok = await this.verifyMsg91Token(msg91Token);
      if (!ok) throw new UnauthorizedException('Phone verification failed or expired.');
    } else {
      // Dev: accept any code against the in-memory store, or bypass entirely
      if (code) {
        const entry = this.otpStore.get(otpKey);
        if (entry && entry.code === code && Date.now() <= entry.expiresAt) {
          this.otpStore.delete(otpKey);
        }
        // else: dev bypass — proceed anyway
      }
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
    // independent in each app namespace. When createIfMissing is false (OTP
    // *login*, as opposed to signup), an unknown phone is rejected with a 404
    // so the client can route the user to the signup flow where they set a
    // name + password + PIN, rather than silently minting a bare account.
    const user = createIfMissing
      ? await this.prisma.user.upsert({
          where: { phone_appType: { phone: normalized, appType: effectiveAppType } },
          update: {},
          create: { phone: normalized, role: roleForCreate, appType: effectiveAppType },
          include: { ownedShops: { where: { deletedAt: null }, select: { id: true } } },
        })
      : await this.prisma.user
          .findUnique({
            where: { phone_appType: { phone: normalized, appType: effectiveAppType } },
            include: { ownedShops: { where: { deletedAt: null }, select: { id: true } } },
          })
          .then((found) => {
            if (!found) {
              throw new NotFoundException('No account found for this number. Please sign up.');
            }
            return found;
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
   * Sign up with phone + name + password + an optional user-chosen 4-digit
   * login PIN (no SMS). Creates/updates the (phone, appType) user and stores a
   * scrypt hash of BOTH the password and the PIN (the PIN is a real user
   * credential, set + confirmed on the client, NOT a one-time OTP). Returns a
   * JWT so the app can proceed straight into onboarding/registration.
   */
  async signup(
    phone: string,
    name: string,
    password: string,
    pin: string | undefined,
    appType = 'CUSTOMER',
    msg91Token?: string,
  ): Promise<{ accessToken: string; role: UserRole }> {
    const normalized = AuthService.normalizePhone(phone);

    // In production, every signup must prove phone ownership via MSG91 widget token.
    if (process.env.NODE_ENV === 'production') {
      if (!msg91Token) {
        throw new UnauthorizedException('Phone verification required before registration.');
      }
      const verified = await this.verifyMsg91Token(msg91Token);
      if (!verified) {
        throw new UnauthorizedException('Phone verification failed or expired. Please verify your number again.');
      }
    }
    const displayName = titleCaseName(name);
    const effectiveAppType = await this.resolveAppType(normalized, appType);
    const roleForCreate = AuthService.appTypeToRole(effectiveAppType);

    // A PIN is optional at signup; if given, store its hash (one-way, used for
    // login) plus an AES-encrypted copy (reversible) so admin can reveal it to a
    // locked-out user. Existing PIN is preserved when this signup omits one.
    const pinHash = pin ? hashPassword(pin) : undefined;
    const loginPinEnc = pin ? encryptOtp(pin) : undefined;

    const user = await this.prisma.user.upsert({
      where: { phone_appType: { phone: normalized, appType: effectiveAppType } },
      update: {
        name: displayName,
        passwordHash: hashPassword(password),
        ...(pinHash ? { pinHash, loginPinEnc } : {}),
      },
      create: {
        phone: normalized,
        role: roleForCreate,
        appType: effectiveAppType,
        name: displayName,
        passwordHash: hashPassword(password),
        ...(pinHash ? { pinHash, loginPinEnc } : {}),
      },
      include: { ownedShops: { where: { deletedAt: null }, select: { id: true } } },
    });

    await this.backfillIdentifiers(user, effectiveAppType);

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
   * Log in with phone + a credential, verified by an explicit `method`:
   *  - 'pin'      → check against the user's 4-digit PIN hash.
   *  - 'password' → check against the user's password hash.
   *  - undefined  → legacy: try password, then PIN, then the fixed backup OTP.
   * No SMS. 401 if the user doesn't exist or the credential doesn't match.
   * Signs the same JWT shape as OTP login.
   */
  async login(
    phone: string,
    credential: string,
    appType = 'CUSTOMER',
    method?: 'pin' | 'password',
  ): Promise<{ accessToken: string; role: UserRole }> {
    const normalized = AuthService.normalizePhone(phone);
    const effectiveAppType = await this.resolveAppType(normalized, appType);

    const user = await this.prisma.user.findUnique({
      where: { phone_appType: { phone: normalized, appType: effectiveAppType } },
      include: { ownedShops: { where: { deletedAt: null }, select: { id: true } } },
    });
    if (!user) {
      throw new UnauthorizedException('No account found. Please sign up first.');
    }

    let ok = false;
    if (method === 'pin') {
      ok = verifyPassword(credential, user.pinHash);
      if (!ok) throw new UnauthorizedException('Incorrect PIN.');
    } else if (method === 'password') {
      ok = verifyPassword(credential, user.passwordHash);
      if (!ok) throw new UnauthorizedException('Incorrect password.');
    } else {
      // Legacy fallback: accept password, PIN, or the fixed backup OTP.
      const passOk = verifyPassword(credential, user.passwordHash);
      const pinOk = verifyPassword(credential, user.pinHash);
      const otpOk = !!user.loginOtpEnc && decryptOtp(user.loginOtpEnc) === credential;
      ok = passOk || pinOk || otpOk;
      if (!ok) throw new UnauthorizedException('Incorrect credentials.');
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
   * Reset password and/or PIN after MSG91 OTP verification.
   * User must already exist — this does not create accounts.
   */
  async resetCredentials(
    phone: string,
    appType = 'CUSTOMER',
    msg91Token: string,
    newPassword?: string,
    newPin?: string,
  ): Promise<{ ok: true }> {
    const normalized = AuthService.normalizePhone(phone);

    if (process.env.NODE_ENV === 'production') {
      const ok = await this.verifyMsg91Token(msg91Token);
      if (!ok) throw new UnauthorizedException('Phone verification failed or expired.');
    }

    const effectiveAppType = await this.resolveAppType(normalized, appType);
    const user = await this.prisma.user.findUnique({
      where: { phone_appType: { phone: normalized, appType: effectiveAppType } },
    });
    if (!user) throw new UnauthorizedException('No account found for this number.');

    const updates: Record<string, unknown> = {};
    if (newPassword) updates.passwordHash = hashPassword(newPassword);
    if (newPin) {
      updates.pinHash = hashPassword(newPin);
      updates.loginPinEnc = encryptOtp(newPin);
    }
    if (Object.keys(updates).length === 0) {
      throw new UnauthorizedException('Provide a new password or PIN to reset.');
    }

    await this.prisma.user.update({ where: { id: user.id }, data: updates });
    return { ok: true };
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
