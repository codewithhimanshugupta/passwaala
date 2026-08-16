import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { OrderStatus, UserRole } from '@nearbaz/shared';
import { createTestApp } from './create-test-app';
import { closeDb, createOrder, createProduct, createShop, prisma, resetDb } from './db';
import { bearer } from './auth';

async function shopkeeperToken(
  app: INestApplication,
  ownerId: string,
  shopId: string,
): Promise<string> {
  const jwt = app.get(JwtService);
  return jwt.signAsync({ sub: ownerId, role: UserRole.SHOPKEEPER, shopId });
}

/**
 * Orders (e2e) — real DB. Covers the shopkeeper incoming feed, accept/reject
 * with reason, the shared state-machine guard on transitions, and cross-shop
 * isolation on the order feed + advance.
 */
describe('Orders (e2e)', () => {
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

  it('shopkeeper sees only their OWN shop’s orders in the feed', async () => {
    const shopA = await createShop();
    const shopB = await createShop();
    const orderA = await createOrder(shopA.shopId);
    await createOrder(shopB.shopId);

    const tokenA = await shopkeeperToken(app, shopA.ownerId, shopA.shopId);
    const res = await request(app.getHttpServer())
      .get('/orders/feed')
      .set(...bearer(tokenA))
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(orderA.orderId);
  });

  it('accepts a PLACED order (PLACED → ACCEPTED)', async () => {
    const { ownerId, shopId } = await createShop();
    const { orderId } = await createOrder(shopId, { status: OrderStatus.PLACED });
    const token = await shopkeeperToken(app, ownerId, shopId);

    const res = await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set(...bearer(token))
      .send({ status: OrderStatus.ACCEPTED })
      .expect(200);
    expect(res.body.status).toBe(OrderStatus.ACCEPTED);
  });

  it('rejects a PLACED order but REQUIRES a reason', async () => {
    const { ownerId, shopId } = await createShop();
    const { orderId } = await createOrder(shopId, { status: OrderStatus.PLACED });
    const token = await shopkeeperToken(app, ownerId, shopId);

    // No reason → 400.
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set(...bearer(token))
      .send({ status: OrderStatus.REJECTED })
      .expect(400);

    // With reason → 200 and reason persisted.
    const res = await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set(...bearer(token))
      .send({ status: OrderStatus.REJECTED, reason: 'Out of stock' })
      .expect(200);
    expect(res.body.status).toBe(OrderStatus.REJECTED);
    const rejected = await prisma.order.findUnique({ where: { id: orderId } });
    expect(rejected?.rejectionReason).toBe('Out of stock');
  });

  it('rejects an ILLEGAL transition via the shared state machine (DELIVERED←PLACED)', async () => {
    const { ownerId, shopId } = await createShop();
    const { orderId } = await createOrder(shopId, { status: OrderStatus.PLACED });
    const token = await shopkeeperToken(app, ownerId, shopId);

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set(...bearer(token))
      .send({ status: OrderStatus.DELIVERED })
      .expect(400);
  });

  it('ISOLATION: shopkeeper A cannot advance shop B’s order (404)', async () => {
    const shopA = await createShop();
    const shopB = await createShop();
    const { orderId: orderB } = await createOrder(shopB.shopId, { status: OrderStatus.PLACED });
    const tokenA = await shopkeeperToken(app, shopA.ownerId, shopA.shopId);

    await request(app.getHttpServer())
      .patch(`/orders/${orderB}/status`)
      .set(...bearer(tokenA))
      .send({ status: OrderStatus.ACCEPTED })
      .expect(404);

    const still = await prisma.order.findUnique({ where: { id: orderB } });
    expect(still?.status).toBe(OrderStatus.PLACED);
  });

  describe('Phase 3 — order loop', () => {
    it('walks the COD happy path PLACED→ACCEPTED→PREPARING→READY→OUT_FOR_DELIVERY→DELIVERED', async () => {
      const { ownerId, shopId } = await createShop();
      const { orderId } = await createOrder(shopId, { status: OrderStatus.PLACED });
      const token = await shopkeeperToken(app, ownerId, shopId);

      const steps = [
        OrderStatus.ACCEPTED,
        OrderStatus.PREPARING,
        OrderStatus.READY,
        OrderStatus.OUT_FOR_DELIVERY,
        OrderStatus.DELIVERED,
      ];
      for (const status of steps) {
        const res = await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set(...bearer(token))
          .send({ status })
          .expect(200);
        expect(res.body.status).toBe(status);
      }
    });

    it('customer claims UPI payment, shop verifies → PREPARING', async () => {
      const { ownerId, shopId } = await createShop();
      const { customerId, orderId } = await createOrder(shopId, {
        status: OrderStatus.AWAITING_PAYMENT,
      });
      const jwt = app.get(JwtService);
      const custToken = await jwt.signAsync({ sub: customerId, role: UserRole.CUSTOMER });

      // Customer's "I've paid" records a CLAIM but does not advance the order.
      const claim = await request(app.getHttpServer())
        .post(`/orders/${orderId}/confirm-payment`)
        .set(...bearer(custToken))
        .expect(201);
      expect(claim.body.status).toBe(OrderStatus.AWAITING_PAYMENT);
      expect(claim.body.paymentClaimedAt).toBeTruthy();

      // Shop verifies money received → PREPARING + paymentConfirmed.
      const shopToken = await shopkeeperToken(app, ownerId, shopId);
      const verified = await request(app.getHttpServer())
        .post(`/orders/${orderId}/payment-received`)
        .set(...bearer(shopToken))
        .expect(201);
      expect(verified.body.status).toBe(OrderStatus.PREPARING);
      expect(verified.body.paymentConfirmed).toBe(true);
    });

    it('marks items unavailable and recomputes the adjusted total', async () => {
      const { ownerId, shopId } = await createShop();
      const { orderId } = await createOrder(shopId, { status: OrderStatus.ACCEPTED });
      // Seed two items on the order.
      const p1 = await prisma.product.create({
        data: { shopId, name: 'A', pricePaise: 5000, mrpPaise: 5000, stock: 5 },
      });
      const p2 = await prisma.product.create({
        data: { shopId, name: 'B', pricePaise: 3000, mrpPaise: 3000, stock: 5 },
      });
      const i1 = await prisma.orderItem.create({
        data: { orderId, productId: p1.id, nameSnapshot: 'A', pricePaiseSnapshot: 5000, qty: 1 },
      });
      await prisma.orderItem.create({
        data: { orderId, productId: p2.id, nameSnapshot: 'B', pricePaiseSnapshot: 3000, qty: 1 },
      });
      const token = await shopkeeperToken(app, ownerId, shopId);

      // Mark item A unavailable → adjusted = 3000 (B) + delivery(0) + platform(1000).
      const res = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/items/unavailable`)
        .set(...bearer(token))
        .send({ orderItemIds: [i1.id] })
        .expect(200);
      expect(res.body.adjustedTotalPaise).toBe(4000);
    });

    it('customer sees their order history and can reorder', async () => {
      const { shopId } = await createShop();
      const { productId } = await createProduct(shopId);
      const { customerId, orderId } = await createOrder(shopId, { status: OrderStatus.DELIVERED });
      // Attach an item to the past order so reorder has something to rebuild.
      await prisma.orderItem.create({
        data: { orderId, productId, nameSnapshot: 'X', pricePaiseSnapshot: 5000, qty: 2 },
      });
      const jwt = app.get(JwtService);
      const custToken = await jwt.signAsync({ sub: customerId, role: UserRole.CUSTOMER });

      const history = await request(app.getHttpServer())
        .get('/orders/history')
        .set(...bearer(custToken))
        .expect(200);
      expect(history.body.items).toHaveLength(1);
      expect(history.body.items[0].orderId).toBe(orderId);

      const re = await request(app.getHttpServer())
        .post(`/orders/${orderId}/reorder`)
        .set(...bearer(custToken))
        .expect(201);
      expect(re.body.rebuilt).toBe(true);

      const cart = await request(app.getHttpServer())
        .get('/cart')
        .set(...bearer(custToken))
        .expect(200);
      expect(cart.body.empty).toBe(false);
      expect(cart.body.items[0].qty).toBe(2);
    });

    it('customer cannot view another customer’s order (404)', async () => {
      const { shopId } = await createShop();
      const { orderId } = await createOrder(shopId);
      const jwt = app.get(JwtService);
      const other = await prisma.user.create({
        data: { phone: '+919222222222', role: UserRole.CUSTOMER },
      });
      const otherToken = await jwt.signAsync({ sub: other.id, role: UserRole.CUSTOMER });

      await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set(...bearer(otherToken))
        .expect(404);
    });
  });
});
