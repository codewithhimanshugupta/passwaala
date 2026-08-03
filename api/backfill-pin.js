/**
 * One-off backfill: set a fixed 4-digit login PIN for every existing user that
 * has no PIN yet. Uses the app's OWN credential helpers so both paths work:
 *   - pinHash     = scrypt hash (what login verifies)
 *   - loginPinEnc = AES-encrypted copy (what the admin panel decrypts to show)
 * NOT raw SQL — a hand-written value could never be a valid scrypt/AES blob.
 *
 * Run against prod by exporting DATABASE_URL/DIRECT_URL (+ AUTH_ENC_KEY if prod
 * sets one) before invoking. Idempotent: only touches users where pinHash IS NULL.
 */
const { PrismaClient } = require('@prisma/client');
const { hashPassword, encryptOtp } = require('./dist/auth/credentials.util.js');

const PIN = process.env.BACKFILL_PIN || '1111';

(async () => {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({
      where: { pinHash: null, deletedAt: null },
      select: { id: true, phone: true, appType: true },
    });
    console.log(`Users without a PIN: ${users.length}`);
    let done = 0;
    for (const u of users) {
      await prisma.user.update({
        where: { id: u.id },
        data: { pinHash: hashPassword(PIN), loginPinEnc: encryptOtp(PIN) },
      });
      done += 1;
      console.log(`  set PIN for ${u.phone} [${u.appType}]`);
    }
    console.log(`Done. Backfilled PIN=${PIN} for ${done} user(s).`);
  } catch (e) {
    console.error('Backfill failed:', e.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
