import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { OrderStatus, UserRole } from '@passwaala/shared';
import { createTestApp } from './create-test-app';
import { closeDb, createOrder, createShop, prisma, resetDb } from './db';
import { bearer } from './auth';

/**
 * Reviews (e2e) — verified-purchase ratings that update the shop's denormalized
 * avgRating/ratingCount.
 */
describe('Reviews (e2e)', () => {
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

  async function custToken(customerId: string) {
    const jwt = app.get(JwtService);
    return jwt.signAsync({ sub: customerId, role: UserRole.CUSTOMER });
  }

  it('rejects reviewing a non-delivered order (400)', async () => {
    const { shopId } = await createShop();
    const { customerId, orderId } = await createOrder(shopId, { status: OrderStatus.PLACED });
    const token = await custToken(customerId);

    await request(app.getHttpServer())
      .post('/reviews')
      .set(...bearer(token))
      .send({ orderId, rating: 5 })
      .expect(400);
  });

  it('creates a review for a delivered order and updates avgRating', async () => {
    const { shopId } = await createShop();
    const { customerId, orderId } = await createOrder(shopId, { status: OrderStatus.DELIVERED });
    const token = await custToken(customerId);

    await request(app.getHttpServer())
      .post('/reviews')
      .set(...bearer(token))
      .send({ orderId, rating: 4, comment: 'Good' })
      .expect(201);

    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    expect(shop?.avgRating).toBe(4);
    expect(shop?.ratingCount).toBe(1);
  });

  it('enforces one review per order (409)', async () => {
    const { shopId } = await createShop();
    const { customerId, orderId } = await createOrder(shopId, { status: OrderStatus.DELIVERED });
    const token = await custToken(customerId);

    await request(app.getHttpServer())
      .post('/reviews')
      .set(...bearer(token))
      .send({ orderId, rating: 5 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/reviews')
      .set(...bearer(token))
      .send({ orderId, rating: 1 })
      .expect(409);
  });

  it('lists a shop’s reviews publicly', async () => {
    const { shopId } = await createShop();
    const { customerId, orderId } = await createOrder(shopId, { status: OrderStatus.DELIVERED });
    const token = await custToken(customerId);
    await request(app.getHttpServer())
      .post('/reviews')
      .set(...bearer(token))
      .send({ orderId, rating: 5, comment: 'Great' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/reviews/shop/${shopId}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].rating).toBe(5);
  });
});
