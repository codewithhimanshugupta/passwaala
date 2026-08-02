import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { closeDb, resetDb } from './db';

/**
 * Harness smoke test — proves the integration setup works end to end against the
 * REAL passwala_test database (plan → Testing Standard). It boots the full Nest
 * app (with global guards + ValidationPipe), hits the public health + auth
 * routes, and confirms the DB reset helper runs.
 *
 * This is the foundation every Phase 1 feature e2e builds on.
 */
describe('Harness (e2e)', () => {
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

  it('GET /health is public and returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('a protected route without a token is 401', async () => {
    // POST /orders requires a CUSTOMER token; no bearer -> JwtAuthGuard 401.
    await request(app.getHttpServer()).post('/orders').send({}).expect(401);
  });

  it('rejects an invalid OTP request body (ValidationPipe)', async () => {
    await request(app.getHttpServer())
      .post('/auth/request-otp')
      .send({ phone: 'not-a-phone' })
      .expect(400);
  });

  it('request-otp then verify-otp issues a JWT (dev bypass: any code)', async () => {
    const phone = '+919876543210';
    await request(app.getHttpServer())
      .post('/auth/request-otp')
      .send({ phone })
      .expect(200);

    // Tests run with NODE_ENV=test, so the DEV OTP bypass is active: any code
    // logs in and returns a JWT. (The production reject-path is unit-tested in
    // auth.service.spec.ts with NODE_ENV forced to production.)
    const res = await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ phone, code: '000000' })
      .expect(200);
    expect(typeof res.body.accessToken).toBe('string');
  });
});
