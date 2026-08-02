import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'crypto';

/**
 * Credential helpers for phone+password auth and the encrypted backup login OTP.
 *
 * - Passwords: scrypt hash, one-way. Stored as "<saltHex>:<hashHex>".
 * - Backup OTP: AES-256-GCM, reversible (admin can reveal it). Stored as
 *   "<ivHex>:<tagHex>:<cipherHex>". Key from AUTH_ENC_KEY (64 hex chars).
 *
 * Uses only Node's built-in `crypto` — no external dependency.
 */

const SCRYPT_KEYLEN = 64;

/** Hash a plaintext password with scrypt + a random 16-byte salt. */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, SCRYPT_KEYLEN);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/** Constant-time verify a plaintext password against a stored scrypt hash. */
export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(plain, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Generate a fixed 6-digit backup login code. */
export function generateLoginOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** The 32-byte AES key from AUTH_ENC_KEY (dev fallback so local runs work). */
function encKey(): Buffer {
  const hex =
    process.env.AUTH_ENC_KEY ||
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  return Buffer.from(hex, 'hex');
}

/** AES-256-GCM encrypt a plaintext OTP → "<ivHex>:<tagHex>:<cipherHex>". */
export function encryptOtp(code: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/** Decrypt an "<ivHex>:<tagHex>:<cipherHex>" OTP. Returns null if unreadable. */
export function decryptOtp(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [ivHex, tagHex, cipherHex] = stored.split(':');
  if (!ivHex || !tagHex || !cipherHex) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, 'hex')),
      decipher.final(),
    ]);
    return dec.toString('utf8');
  } catch {
    return null; // wrong key / tampered ciphertext
  }
}
