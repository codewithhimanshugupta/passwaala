import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PaymentMethod, OrderStatus, UserRole } from '@nearbaz/shared';
import { createTestApp } from './create-test-app';
import { closeDb, createProduct, createShop, prisma, resetDb } from './db';
import { bearer, createUser } from './auth';

/**
 * POS counter-sale (e2e) — real DB. Covers POST /orders/pos: catalog + free-text
 * lines, cash-only enforcement, DELIVERED/commission-free/self-pickup shape,
 * stock decrement, and exactly-once idempotency across offline replays.
 */
describe('POS counter-sale (e2e)', () => {
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

  /** Open shop + one catalog product + a shopkeeper token scoped to that shop. */
  async function setup(opts: { stock?: number; pricePaise?: number } = {}) {
    const { ownerId, shopId } = await createShop({ isOpen: true });
    const { productId } = await createProduct(shopId, {
      pricePaise: opts.pricePaise ?? 5000,
      stock: opts.stock ?? 10,
      name: 'Parle-G',
    });
    // Shopkeeper token carrying shopId — the endpoint reads @ShopId from the JWT.
    const { token } = await createUser(app, UserRole.SHOPKEEPER, shopId);
    return { shopId, productId, ownerId, token };
  }

  it('rings up a mixed catalog + free-text cash sale (DELIVERED, decrements stock)', async () => {
    const { shopId, productId, token } = await setup({ stock: 10, pricePaise: 5000 });

    const res = await request(app.getHttpServer())
      .post('/orders/pos')
      .set(...bearer(token))
      .send({
        items: [
          { productId, qty: 2 }, // catalog: 2 × ₹50 = ₹100 (price from DB)
          { name: 'Loose sugar 1kg', pricePaise: 4200, qty: 1 }, // free-text
        ],
        paymentMethod: PaymentMethod.CASH,
        cashTenderedPaise: 20000,
        idempotencyKey: 'pos-key-1',
      })
      .expect(201);

    expect(res.body.shopId).toBe(shopId);
    expect(res.body.status).toBe(OrderStatus.DELIVERED);
    expect(res.body.paymentMethod).toBe(PaymentMethod.CASH);
    expect(res.body.subtotalPaise).toBe(2 * 5000 + 4200);
    expect(res.body.totalPaise).toBe(2 * 5000 + 4200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.shortId).toBeTruthy();

    // Order row: POS sale, commission-free, self-pickup, payment confirmed.
    const order = await prisma.order.findUnique({ where: { id: res.body.orderId } });
    expect(order?.isPosSale).toBe(true);
    expect(order?.commissionRateSnapshot).toBe(0);
    expect(order?.platformFeePaise).toBe(0);
    expect(order?.deliveryFeePaise).toBe(0);
    expect(order?.paymentConfirmed).toBe(true);

    // Catalog stock decremented by 2; free-text line touches no product.
    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product?.stock).toBe(8);
  });

  it('is idempotent: replaying the same key returns the same sale, no double decrement', async () => {
    const { productId, token } = await setup({ stock: 10 });
    const body = {
      items: [{ productId, qty: 3 }],
      paymentMethod: PaymentMethod.CASH,
      idempotencyKey: 'pos-key-dup',
    };

    const first = await request(app.getHttpServer()).post('/orders/pos').set(...bearer(token)).send(body).expect(201);
    const second = await request(app.getHttpServer()).post('/orders/pos').set(...bearer(token)).send(body).expect(201);

    expect(second.body.orderId).toBe(first.body.orderId); // same sale, not a duplicate
    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product?.stock).toBe(7); // decremented once (10 → 7), not twice
    const count = await prisma.order.count({ where: { idempotencyKey: 'pos-key-dup' } });
    expect(count).toBe(1);
  });

  it('rejects a non-cash payment method (POS is cash-only)', async () => {
    const { productId, token } = await setup();
    await request(app.getHttpServer())
      .post('/orders/pos')
      .set(...bearer(token))
      .send({
        items: [{ productId, qty: 1 }],
        paymentMethod: PaymentMethod.UPI_DIRECT,
        idempotencyKey: 'pos-key-upi',
      })
      .expect(400);
  });

  it('rejects an empty sale', async () => {
    const { token } = await setup();
    await request(app.getHttpServer())
      .post('/orders/pos')
      .set(...bearer(token))
      .send({ items: [], paymentMethod: PaymentMethod.CASH, idempotencyKey: 'pos-key-empty' })
      .expect(400);
  });

  it('rejects an out-of-stock catalog line', async () => {
    const { productId, token } = await setup({ stock: 1 });
    await request(app.getHttpServer())
      .post('/orders/pos')
      .set(...bearer(token))
      .send({
        items: [{ productId, qty: 5 }], // only 1 in stock
        paymentMethod: PaymentMethod.CASH,
        idempotencyKey: 'pos-key-oos',
      })
      .expect(400);
  });

  it('rejects a catalog product from another shop', async () => {
    const { token } = await setup();
    const { shopId: otherShopId } = await createShop({ isOpen: true });
    const { productId: foreignProduct } = await createProduct(otherShopId, { stock: 10 });
    await request(app.getHttpServer())
      .post('/orders/pos')
      .set(...bearer(token))
      .send({
        items: [{ productId: foreignProduct, qty: 1 }],
        paymentMethod: PaymentMethod.CASH,
        idempotencyKey: 'pos-key-foreign',
      })
      .expect(400);
  });

  it('requires a shop-scoped token (401 without auth)', async () => {
    await request(app.getHttpServer())
      .post('/orders/pos')
      .send({ items: [{ name: 'x', pricePaise: 100, qty: 1 }], paymentMethod: PaymentMethod.CASH, idempotencyKey: 'pos-key-noauth' })
      .expect(401);
  });
});
