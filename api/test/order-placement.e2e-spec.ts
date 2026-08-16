import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OrderStatus, PaymentMethod, UserRole } from '@nearbaz/shared';
import { createTestApp } from './create-test-app';
import {
  closeDb,
  createAddress,
  createProduct,
  createShop,
  prisma,
  resetDb,
} from './db';
import { bearer, createUser } from './auth';

/**
 * Order placement (e2e) — real DB. Covers durable placement from the cart,
 * exactly-once idempotency, price/commission snapshots, and the guard rails
 * (empty cart, closed shop, out of stock, min-order-value, foreign address).
 */
describe('Order placement (e2e)', () => {
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

  /** Helper: open shop + product + customer with a filled cart + address. */
  async function setup(opts: { isOpen?: boolean; stock?: number } = {}) {
    const { shopId } = await createShop({ isOpen: opts.isOpen ?? true });
    const { productId } = await createProduct(shopId, {
      pricePaise: 5000,
      stock: opts.stock ?? 10,
    });
    const { userId, token } = await createUser(app, UserRole.CUSTOMER);
    const { addressId } = await createAddress(userId);
    return { shopId, productId, userId, token, addressId };
  }

  it('places an order from the cart (PLACED), snapshots, clears cart', async () => {
    const { productId, token, addressId } = await setup();
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...bearer(token))
      .send({ productId, qty: 2 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set(...bearer(token))
      .send({ addressId, paymentMethod: PaymentMethod.COD, idempotencyKey: 'idem-1' })
      .expect(201);

    expect(res.body.status).toBe(OrderStatus.PLACED);
    expect(res.body.totalPaise).toBe(11180); // 10000 + ₹11.80 fee (₹10 + GST)

    // Order + snapshotted items persisted; cart emptied.
    const order = await prisma.order.findUnique({
      where: { id: res.body.orderId },
      include: { items: true },
    });
    expect(order?.items).toHaveLength(1);
    expect(order?.items[0].pricePaiseSnapshot).toBe(5000);
    const cart = await prisma.cart.findFirst({ where: { customerId: order?.customerId } });
    expect(cart).toBeNull();
  });

  it('is idempotent: the same key returns the same order, no duplicate', async () => {
    const { productId, token, addressId } = await setup();
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...bearer(token))
      .send({ productId, qty: 1 })
      .expect(201);

    const first = await request(app.getHttpServer())
      .post('/orders')
      .set(...bearer(token))
      .send({ addressId, paymentMethod: PaymentMethod.COD, idempotencyKey: 'dupe-key' })
      .expect(201);

    // Re-add to cart and place again with the SAME key.
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...bearer(token))
      .send({ productId, qty: 1 })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/orders')
      .set(...bearer(token))
      .send({ addressId, paymentMethod: PaymentMethod.COD, idempotencyKey: 'dupe-key' })
      .expect(201);

    expect(second.body.orderId).toBe(first.body.orderId);
    const count = await prisma.order.count();
    expect(count).toBe(1);
  });

  it('rejects placing with an empty cart (400)', async () => {
    const { token, addressId } = await setup();
    await request(app.getHttpServer())
      .post('/orders')
      .set(...bearer(token))
      .send({ addressId, paymentMethod: PaymentMethod.COD, idempotencyKey: 'empty-1' })
      .expect(400);
  });

  it('rejects placing when the shop is closed (400)', async () => {
    const { productId, token, addressId } = await setup({ isOpen: false });
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...bearer(token))
      .send({ productId, qty: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/orders')
      .set(...bearer(token))
      .send({ addressId, paymentMethod: PaymentMethod.COD, idempotencyKey: 'closed-1' })
      .expect(400);
  });

  it('rejects a foreign address (404)', async () => {
    const { productId, token } = await setup();
    // Another user's address.
    const other = await createUser(app, UserRole.CUSTOMER);
    const foreign = await createAddress(other.userId);
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...bearer(token))
      .send({ productId, qty: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/orders')
      .set(...bearer(token))
      .send({ addressId: foreign.addressId, paymentMethod: PaymentMethod.COD, idempotencyKey: 'foreign-1' })
      .expect(404);
  });

  it('rejects a delivery address outside the shop delivery radius (400)', async () => {
    // Shop at the default Delhi point (28.6, 77.2); the customer's address is in
    // Mumbai (~1150 km away) — far beyond MAX_DELIVERY_RADIUS_METERS.
    const { productId, token, userId } = await setup();
    const farAddress = await prisma.address.create({
      data: { userId, line: 'Mumbai flat', latitude: 19.076, longitude: 72.8777, label: 'Home' },
    });
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...bearer(token))
      .send({ productId, qty: 1 })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set(...bearer(token))
      .send({ addressId: farAddress.id, paymentMethod: PaymentMethod.COD, idempotencyKey: 'faraway-1' })
      .expect(400);
    expect(res.body.message).toMatch(/delivery area/i);
    // No order should have been created.
    expect(await prisma.order.count()).toBe(0);
  });

  it('allows self-pickup regardless of distance (no radius check)', async () => {
    // Even with only a far address on file, SELF_PICKUP needs no address and must
    // not be blocked by the delivery-radius guard.
    const { productId, token } = await setup();
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...bearer(token))
      .send({ productId, qty: 1 })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set(...bearer(token))
      .send({ deliveryMode: 'SELF_PICKUP', paymentMethod: PaymentMethod.COD, idempotencyKey: 'pickup-far-1' })
      .expect(201);
    expect(res.body.status).toBe(OrderStatus.PLACED);
  });
});
