/**
 * Reviewer / QA seed — creates ONE login per app (customer, shopkeeper, rider)
 * so Apple App Review and Google Play reviewers can sign in WITHOUT receiving an
 * SMS OTP. The apps log in with phone + a 4-digit PIN (api.login method:'pin'),
 * so we just seed each account with a known PIN hash.
 *
 * SAFE FOR PRODUCTION: unlike prisma/seed.ts this NEVER truncates — it upserts
 * only these three rows (idempotent, re-runnable). No other data is touched.
 *
 * Run (against whichever DATABASE_URL is set):
 *   cd api && npx ts-node prisma/seed-reviewer.ts
 *
 * The credentials below are what you paste into the store "App Access" /
 * "Sign-in required" reviewer-notes fields. Change REVIEWER_PIN if you want, then
 * re-run. Give reviewers the phone WITHOUT +91 (the app prepends it).
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/credentials.util';

const prisma = new PrismaClient();

// 4-digit PIN reviewers type on the login screen (method: PIN). Keep it simple.
const REVIEWER_PIN = '246810';
const REVIEWER_PIN_4 = '2468'; // apps validate PIN as exactly 4 digits — use this one

const ACCOUNTS: Array<{ phone: string; appType: string; role: string; name: string }> = [
  { phone: '+919000012345', appType: 'CUSTOMER', role: 'CUSTOMER', name: 'App Reviewer (Customer)' },
  { phone: '+919000023456', appType: 'SHOPKEEPER', role: 'SHOPKEEPER', name: 'App Reviewer (Shop)' },
  { phone: '+919000034567', appType: 'RIDER', role: 'RIDER', name: 'App Reviewer (Rider)' },
];

async function main() {
  const pinHash = hashPassword(REVIEWER_PIN_4);
  // A password too, so the 'password' login method also works for reviewers.
  const passwordHash = hashPassword('Review@2026');

  for (const a of ACCOUNTS) {
    const user = await prisma.user.upsert({
      where: { phone_appType: { phone: a.phone, appType: a.appType } },
      update: { name: a.name, pinHash, passwordHash },
      create: {
        phone: a.phone,
        appType: a.appType,
        role: a.role as never,
        name: a.name,
        pinHash,
        passwordHash,
      },
    });
    // Backfill identifiers the same way AuthService does (idempotent).
    if (!user.referralCode) {
      const rc = `PW${user.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
      await prisma.user.update({ where: { id: user.id }, data: { referralCode: rc } });
    }
    console.log(`  ✓ ${a.appType.padEnd(10)} ${a.phone}  PIN ${REVIEWER_PIN_4}`);
  }

  console.log('\n✅ Reviewer accounts ready. Paste into store App Access notes:');
  console.log('   Customer app  → phone 9000012345, PIN 2468');
  console.log('   Shopkeeper app→ phone 9000023456, PIN 2468');
  console.log('   Rider app     → phone 9000034567, PIN 2468');
  console.log('   (password login also works: password "Review@2026")');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
