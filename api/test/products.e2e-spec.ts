import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { UserRole } from '@passwaala/shared';
import { createTestApp } from './create-test-app';
import { closeDb, createShop, prisma, resetDb } from './db';
import { bearer } from './auth';

/** Mint a SHOPKEEPER token scoped to a specific existing shop/owner. */
async function shopkeeperToken(
  app: INestApplication,
  ownerId: string,
  shopId: string,
): Promise<string> {
  const jwt = app.get(JwtService);
  return jwt.signAsync({ sub: ownerId, role: UserRole.SHOPKEEPER, shopId });
}

/**
 * Products (e2e) — real DB. Covers shop-scoped CRUD and the HARD Shop Data
 * Isolation rule: shopkeeper A can never read/update/delete shop B's products
 * (403/404, never data). This isolation test is part of the CI merge gate.
 */
describe('Products (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('creates and lists a product in the caller’s own shop', async () => {
    const { ownerId, shopId } = await createShop();
    const token = await shopkeeperToken(app, ownerId, shopId);

    const created = await request(app.getHttpServer())
      .post('/products')
      .set(...bearer(token))
      .send({ name: 'Amul Butter', pricePaise: 5500, mrpPaise: 6000, stock: 10 })
      .expect(201);
    expect(created.body.shopId).toBe(shopId);
    expect(created.body.pricePaise).toBe(5500);

    const list = await request(app.getHttpServer())
      .get('/products/mine')
      .set(...bearer(token))
      .expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('ISOLATION: shopkeeper A cannot update shop B’s product (404, no leak)', async () => {
    const shopA = await createShop();
    const shopB = await createShop();
    const tokenA = await shopkeeperToken(app, shopA.ownerId, shopA.shopId);

    // A product owned by shop B.
    const productB = await prisma.product.create({
      data: { shopId: shopB.shopId, name: 'B Milk', pricePaise: 3000, mrpPaise: 3000, stock: 5 },
    });

    // Shopkeeper A tries to update B's product → 404 (never reveals it exists).
    await request(app.getHttpServer())
      .patch(`/products/${productB.id}`)
      .set(...bearer(tokenA))
      .send({ pricePaise: 1 })
      .expect(404);

    // And can't delete it either.
    await request(app.getHttpServer())
      .delete(`/products/${productB.id}`)
      .set(...bearer(tokenA))
      .expect(404);

    // B's product is untouched.
    const still = await prisma.product.findUnique({ where: { id: productB.id } });
    expect(still?.pricePaise).toBe(3000);
    expect(still?.deletedAt).toBeNull();
  });

  it('ISOLATION: /products/mine only ever returns the caller’s shop products', async () => {
    const shopA = await createShop();
    const shopB = await createShop();
    const tokenA = await shopkeeperToken(app, shopA.ownerId, shopA.shopId);

    await prisma.product.create({
      data: { shopId: shopA.shopId, name: 'A1', pricePaise: 100, mrpPaise: 100 },
    });
    await prisma.product.create({
      data: { shopId: shopB.shopId, name: 'B1', pricePaise: 100, mrpPaise: 100 },
    });

    const list = await request(app.getHttpServer())
      .get('/products/mine')
      .set(...bearer(tokenA))
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].shopId).toBe(shopA.shopId);
  });

  it('a CUSTOMER token is forbidden from shopkeeper product routes (403)', async () => {
    const jwt = app.get(JwtService);
    const custUser = await prisma.user.create({
      data: { phone: '+919111111111', role: UserRole.CUSTOMER },
    });
    const custToken = await jwt.signAsync({ sub: custUser.id, role: UserRole.CUSTOMER });

    await request(app.getHttpServer())
      .post('/products')
      .set(...bearer(custToken))
      .send({ name: 'X', pricePaise: 1, mrpPaise: 1 })
      .expect(403);
  });

  it('public catalog lists an APPROVED shop’s products without exact stock', async () => {
    const { shopId } = await createShop();
    await prisma.product.create({
      data: { shopId, name: 'Bread', pricePaise: 4000, mrpPaise: 4000, stock: 7, available: true },
    });

    const res = await request(app.getHttpServer())
      .get(`/products?shopId=${shopId}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].inStock).toBe(true);
    expect(res.body[0].stock).toBeUndefined(); // exact stock never exposed
  });
});
