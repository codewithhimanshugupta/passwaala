import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PaymentMethod, UserRole } from '@nearbaz/shared';
import { createTestApp } from './create-test-app';
import { closeDb, createAddress, createProduct, createShop, prisma, resetDb } from './db';
import { bearer, createUser } from './auth';

/**
 * Coin redemption (e2e): 1 coin = ₹1, discounts the item SUBTOTAL only, capped
 * by balance + subtotal; balance is deducted on placement.
 */
describe('Coin redemption (e2e)', () => {
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

  it('applies coins to the subtotal, caps by balance, and deducts the balance', async () => {
    const { shopId } = await createShop({ isOpen: true });
    const { productId } = await createProduct(shopId, { pricePaise: 10000, stock: 5 }); // ₹100
    const { userId, token } = await createUser(app, UserRole.CUSTOMER);
    const { addressId } = await createAddress(userId);
    // Give the customer 30 coins.
    await prisma.user.update({ where: { id: userId }, data: { coinBalance: 30 } });

    await request(app.getHttpServer()).post('/cart/items').set(...bearer(token)).send({ productId, qty: 1 }).expect(201);

    // Bill = 10000 subtotal + 1180 platform fee = 11180. Redeem 30 coins = ₹30.
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set(...bearer(token))
      .send({ addressId, paymentMethod: PaymentMethod.COD, idempotencyKey: 'coins-1', redeemCoins: 30 })
      .expect(201);

    // Total = 11180 - 3000 = 8180.
    expect(res.body.totalPaise).toBe(8180);

    // Balance fully spent.
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.coinBalance).toBe(0);

    const order = await prisma.order.findUnique({ where: { id: res.body.orderId } });
    expect(order?.coinsRedeemedPaise).toBe(3000);
  });

  it('caps redemption at the customer balance (can’t redeem more than owned)', async () => {
    const { shopId } = await createShop({ isOpen: true });
    const { productId } = await createProduct(shopId, { pricePaise: 20000, stock: 5 });
    const { userId, token } = await createUser(app, UserRole.CUSTOMER);
    const { addressId } = await createAddress(userId);
    await prisma.user.update({ where: { id: userId }, data: { coinBalance: 10 } }); // only 10 coins

    await request(app.getHttpServer()).post('/cart/items').set(...bearer(token)).send({ productId, qty: 1 }).expect(201);
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set(...bearer(token))
      .send({ addressId, paymentMethod: PaymentMethod.COD, idempotencyKey: 'coins-2', redeemCoins: 999 })
      .expect(201);

    // Only 10 coins (₹10 = 1000 paise) applied. Bill 20000+1180=21180 → 20180.
    expect(res.body.totalPaise).toBe(20180);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.coinBalance).toBe(0);
  });
});
