import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DeliveryMode, OrderStatus, PaymentMethod, UserRole } from '@nearbaz/shared';
import { createTestApp } from './create-test-app';
import { closeDb, createProduct, createShop, prisma, resetDb } from './db';
import { bearer, createUser } from './auth';

/**
 * Self-pickup + handoff-OTP (e2e). A pickup order needs no address, has ₹0
 * delivery fee, and can only be marked DELIVERED with the correct handoff OTP.
 */
describe('Self-pickup + handoff OTP (e2e)', () => {
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

  async function shopkeeperToken(ownerId: string, shopId: string) {
    const jwt = app.get(JwtService);
    return jwt.signAsync({ sub: ownerId, role: UserRole.SHOPKEEPER, shopId });
  }

  it('places a SELF_PICKUP order with no address + ₹0 delivery fee + a handoff OTP', async () => {
    const { shopId } = await createShop({ isOpen: true });
    await prisma.shop.update({ where: { id: shopId }, data: { deliveryFeePaise: 5000 } });
    const { productId } = await createProduct(shopId, { pricePaise: 8000, stock: 5 });
    const { token } = await createUser(app, UserRole.CUSTOMER);

    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...bearer(token))
      .send({ productId, qty: 1 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set(...bearer(token))
      .send({ deliveryMode: DeliveryMode.SELF_PICKUP, paymentMethod: PaymentMethod.COD, idempotencyKey: 'pickup-1' })
      .expect(201);

    // Pickup: no delivery fee; total = subtotal + ₹11.80 platform fee.
    expect(res.body.deliveryFeePaise).toBe(0);
    expect(res.body.totalPaise).toBe(8000 + 1180);

    const order = await prisma.order.findUnique({ where: { id: res.body.orderId } });
    expect(order?.deliveryMode).toBe(DeliveryMode.SELF_PICKUP);
    expect(order?.addressId).toBeNull();
    expect(order?.pickupOtp).toMatch(/^\d{4}$/);
  });

  it('blocks DELIVERED without the correct handoff OTP, allows it with', async () => {
    const { ownerId, shopId } = await createShop({ isOpen: true });
    const { productId } = await createProduct(shopId, { pricePaise: 5000, stock: 5 });
    const { token } = await createUser(app, UserRole.CUSTOMER);
    await request(app.getHttpServer()).post('/cart/items').set(...bearer(token)).send({ productId, qty: 1 }).expect(201);
    const placed = await request(app.getHttpServer())
      .post('/orders')
      .set(...bearer(token))
      .send({ deliveryMode: DeliveryMode.SELF_PICKUP, paymentMethod: PaymentMethod.COD, idempotencyKey: 'pickup-2' })
      .expect(201);
    const orderId = placed.body.orderId as string;
    const otp = (await prisma.order.findUnique({ where: { id: orderId } }))!.pickupOtp!;

    const skToken = await shopkeeperToken(ownerId, shopId);
    // Advance to READY (COD path: ACCEPTED → PREPARING → READY → OUT_FOR_DELIVERY).
    for (const status of [OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.OUT_FOR_DELIVERY]) {
      await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).set(...bearer(skToken)).send({ status }).expect(200);
    }

    // Wrong / missing OTP → 400.
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set(...bearer(skToken))
      .send({ status: OrderStatus.DELIVERED, otp: '0000' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set(...bearer(skToken))
      .send({ status: OrderStatus.DELIVERED })
      .expect(400);

    // Correct OTP → 200 DELIVERED.
    const done = await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set(...bearer(skToken))
      .send({ status: OrderStatus.DELIVERED, otp })
      .expect(200);
    expect(done.body.status).toBe(OrderStatus.DELIVERED);
  });
});
