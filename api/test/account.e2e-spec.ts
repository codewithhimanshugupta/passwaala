import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { UserRole } from '@nearbaz/shared';
import { createTestApp } from './create-test-app';
import { closeDb, prisma, resetDb } from './db';
import { bearer, createUser } from './auth';

/**
 * Account (e2e) — profile + in-app account deletion (app-store gate): PII is
 * anonymized and the user soft-deleted, while order/ledger history is retained.
 */
describe('Account (e2e)', () => {
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

  it('returns the caller’s profile and updates the name', async () => {
    const { userId, token } = await createUser(app, UserRole.CUSTOMER);
    const me = await request(app.getHttpServer()).get('/account/me').set(...bearer(token)).expect(200);
    expect(me.body.id).toBe(userId);

    const updated = await request(app.getHttpServer())
      .patch('/account/me')
      .set(...bearer(token))
      .send({ name: 'Asha' })
      .expect(200);
    expect(updated.body.name).toBe('Asha');
  });

  it('deletes the account: anonymizes PII + soft-deletes, retains history', async () => {
    const { userId, token } = await createUser(app, UserRole.CUSTOMER);

    await request(app.getHttpServer()).delete('/account/me').set(...bearer(token)).expect(200);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.deletedAt).not.toBeNull();
    expect(user?.name).toBeNull();
    expect(user?.phone).toBe(`deleted:${userId}`); // PII scrambled

    // The account no longer resolves via /account/me (soft-deleted).
    await request(app.getHttpServer()).get('/account/me').set(...bearer(token)).expect(404);
  });
});

/**
 * Admin dashboard (e2e) — cross-shop aggregate stats, owner/admin only.
 */
describe('Admin dashboard (e2e)', () => {
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

  it('is owner/admin only (403 for others)', async () => {
    const { token } = await createUser(app, UserRole.CUSTOMER);
    await request(app.getHttpServer()).get('/admin/dashboard').set(...bearer(token)).expect(403);
  });

  it('returns aggregate stats', async () => {
    const jwt = app.get(JwtService);
    const admin = await prisma.user.create({ data: { phone: '+919444444444', role: UserRole.ADMIN } });
    const adminToken = await jwt.signAsync({ sub: admin.id, role: UserRole.ADMIN });

    const res = await request(app.getHttpServer())
      .get('/admin/dashboard')
      .set(...bearer(adminToken))
      .expect(200);
    expect(res.body).toHaveProperty('gmvPaise');
    expect(res.body).toHaveProperty('nearbazRevenuePaise');
    expect(res.body).toHaveProperty('activeShops');
  });
});
