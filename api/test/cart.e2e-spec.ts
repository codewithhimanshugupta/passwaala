import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserRole } from '@passwaala/shared';
import { createTestApp } from './create-test-app';
import { closeDb, createProduct, createShop, prisma, resetDb } from './db';
import { bearer, createUser } from './auth';

/**
 * Cart (e2e) — real DB. Covers the single-shop-cart rule, the bill breakdown
 * (subtotal + delivery + flat ₹10 platform fee), and min-order-value gating.
 */
describe('Cart (e2e)', () => {
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

  it('adds an item and returns a bill with the flat ₹10 platform fee', async () => {
    const { shopId } = await createShop();
    const { productId } = await createProduct(shopId, { pricePaise: 5000 });
    const { token } = await createUser(app, UserRole.CUSTOMER);

    const res = await request(app.getHttpServer())
      .post('/cart/items')
      .set(...bearer(token))
      .send({ productId, qty: 2 })
      .expect(201);

    expect(res.body.empty).toBe(false);
    expect(res.body.bill.subtotalPaise).toBe(10000);
    expect(res.body.bill.platformFeePaise).toBe(1180); // ₹10 + 18% GST
    expect(res.body.bill.totalPaise).toBe(11180);
  });

  it('enforces the single-shop-cart rule (409 on a different shop)', async () => {
    const shopA = await createShop();
    const shopB = await createShop();
    const prodA = await createProduct(shopA.shopId);
    const prodB = await createProduct(shopB.shopId);
    const { token } = await createUser(app, UserRole.CUSTOMER);

    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...bearer(token))
      .send({ productId: prodA.productId, qty: 1 })
      .expect(201);

    // Adding shop B's product to a shop-A cart → conflict.
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...bearer(token))
      .send({ productId: prodB.productId, qty: 1 })
      .expect(409);
  });

  it('surfaces min-order-value status (amount to add)', async () => {
    const { shopId } = await createShop();
    await prisma.shop.update({ where: { id: shopId }, data: { minOrderValuePaise: 20000 } });
    const { productId } = await createProduct(shopId, { pricePaise: 5000 });
    const { token } = await createUser(app, UserRole.CUSTOMER);

    const res = await request(app.getHttpServer())
      .post('/cart/items')
      .set(...bearer(token))
      .send({ productId, qty: 1 }) // 5000 < 20000
      .expect(201);

    expect(res.body.meetsMinOrder).toBe(false);
    expect(res.body.amountToMinOrderPaise).toBe(15000);
  });

  it('waives delivery fee at/above the free-delivery threshold', async () => {
    const { shopId } = await createShop();
    await prisma.shop.update({
      where: { id: shopId },
      data: { deliveryFeePaise: 3000, freeDeliveryAbovePaise: 9000 },
    });
    const { productId } = await createProduct(shopId, { pricePaise: 5000 });
    const { token } = await createUser(app, UserRole.CUSTOMER);

    const res = await request(app.getHttpServer())
      .post('/cart/items')
      .set(...bearer(token))
      .send({ productId, qty: 2 }) // 10000 >= 9000 → free delivery
      .expect(201);

    expect(res.body.bill.deliveryFeePaise).toBe(0);
  });

  it('clears the cart', async () => {
    const { shopId } = await createShop();
    const { productId } = await createProduct(shopId);
    const { token } = await createUser(app, UserRole.CUSTOMER);

    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...bearer(token))
      .send({ productId, qty: 1 })
      .expect(201);

    await request(app.getHttpServer()).delete('/cart').set(...bearer(token)).expect(200);

    const res = await request(app.getHttpServer()).get('/cart').set(...bearer(token)).expect(200);
    expect(res.body.empty).toBe(true);
  });

  it('any authenticated user (even a SHOPKEEPER) can use the customer cart', async () => {
    // Customer surface is open to all authenticated users (a shopkeeper can shop too).
    const { token } = await createUser(app, UserRole.SHOPKEEPER);
    const res = await request(app.getHttpServer()).get('/cart').set(...bearer(token)).expect(200);
    expect(res.body.empty).toBe(true);
  });

  it('an unauthenticated request to the cart is 401', async () => {
    await request(app.getHttpServer()).get('/cart').expect(401);
  });
});
