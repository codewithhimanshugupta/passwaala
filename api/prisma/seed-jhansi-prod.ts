/**
 * PROD-SAFE seed — 25 approved Jhansi shops (with products) all owned by the
 * SHOPKEEPER account on phone 9876543210. Reuses the shop/product catalog from
 * prisma/seed.ts (imported — its destructive main() is guarded by require.main).
 *
 * UNLIKE prisma/seed.ts this NEVER truncates. It is idempotent / re-runnable:
 *   - owner user upserted by (phone, appType)
 *   - each shop matched by (ownerId, name): created if missing, else updated
 *   - products created only when a shop has none yet
 *
 * Run (against whichever DATABASE_URL is set):
 *   cd api && npx ts-node prisma/seed-jhansi-prod.ts
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/credentials.util';
import { SHOPS, PRODUCTS, PRODUCT_IMAGES, getBanner, getLogo } from './seed';

const prisma = new PrismaClient();

const OWNER_PHONE = '9876543210'; // stored as 10 digits (phones have no +91 prefix)
const OWNER_NAME = 'Himanshu Jain';
const PIN = '2468'; // 4-digit PIN login
const PASSWORD = 'Shop@2026'; // password login

async function setGeog(shopId: string, lng: number, lat: number) {
  await prisma.$executeRawUnsafe(
    `UPDATE "Shop" SET geog = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE id = $3`,
    lng, lat, shopId,
  );
}

async function main() {
  const pinHash = hashPassword(PIN);
  const passwordHash = hashPassword(PASSWORD);

  const owner = await prisma.user.upsert({
    where: { phone_appType: { phone: OWNER_PHONE, appType: 'SHOPKEEPER' } },
    update: { name: OWNER_NAME, role: 'SHOPKEEPER', pinHash, passwordHash },
    create: {
      phone: OWNER_PHONE, appType: 'SHOPKEEPER', role: 'SHOPKEEPER',
      name: OWNER_NAME, pinHash, passwordHash,
    },
  });
  if (!owner.referralCode) {
    const rc = `PW${owner.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
    await prisma.user.update({ where: { id: owner.id }, data: { referralCode: rc } });
  }

  const holiday = new Date();
  holiday.setMonth(holiday.getMonth() + 1);

  let created = 0, updated = 0, productsCreated = 0;

  for (const s of SHOPS) {
    const banner = getBanner(s.cat);
    const logo = getLogo(s.cat);
    const data = {
      ownerId: owner.id,
      name: s.name,
      shopCategory: s.cat,
      city: 'Jhansi',
      addressLine: `${s.area}, Jhansi`,
      storefrontPhotoUrl: banner,
      bannerUrl: banner,
      logoUrl: logo,
      upiVpa: s.upi,
      latitude: s.off.lat,
      longitude: s.off.lng,
      isOpen: s.open,
      verificationStatus: 'APPROVED' as const,
      avgRating: s.rating,
      ratingCount: s.rc,
      minOrderValuePaise: s.min,
      deliveryFeePaise: s.delivery,
      freeDeliveryAbovePaise: s.free,
      platformDeliveryEnabled: s.platform,
      selfPickupEnabled: s.self,
      commissionFreeUntil: holiday,
      creditLimitPaise: 50000,
    };

    const existing = await prisma.shop.findFirst({
      where: { ownerId: owner.id, name: s.name, deletedAt: null },
      select: { id: true },
    });

    let shopId: string;
    if (existing) {
      await prisma.shop.update({ where: { id: existing.id }, data });
      shopId = existing.id;
      updated++;
    } else {
      const shop = await prisma.shop.create({ data });
      shopId = shop.id;
      created++;
    }
    await setGeog(shopId, s.off.lng, s.off.lat);

    const count = await prisma.product.count({ where: { shopId } });
    if (count === 0) {
      const imgs = PRODUCT_IMAGES[s.cat] ?? [];
      const defs = PRODUCTS[s.cat] ?? [];
      for (let i = 0; i < defs.length; i++) {
        const [name, price, mrp, stock] = defs[i];
        await prisma.product.create({
          data: {
            shopId, name, pricePaise: price, mrpPaise: mrp, stock,
            available: true, orderCount: 0, imageUrl: imgs[i] ?? null,
          },
        });
        productsCreated++;
      }
    }
    process.stdout.write(`  ${existing ? '↻' : '✓'} ${s.name} (${s.area})\n`);
  }

  console.log('\n✅ Jhansi shops ready.');
  console.log(`   owner phone ${OWNER_PHONE} | shops: ${created} created, ${updated} updated | products created: ${productsCreated}`);
  console.log(`   Shopkeeper login → phone ${OWNER_PHONE}, PIN ${PIN} (or password "${PASSWORD}")`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
