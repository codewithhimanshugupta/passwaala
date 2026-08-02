import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { UserRole } from '@passwaala/shared';
import { createTestApp } from './create-test-app';
import { closeDb, prisma, resetDb } from './db';
import { bearer } from './auth';

async function tokenFor(app: INestApplication, role: UserRole, phone: string) {
  const jwt = app.get(JwtService);
  const user = await prisma.user.create({ data: { phone, role } });
  return { token: await jwt.signAsync({ sub: user.id, role }), userId: user.id };
}

/**
 * Owner admin-management (e2e) — the OWNER-only invite → approve → revoke flow
 * (plan → Security: admins require owner approval; no self-created admins).
 */
describe('Owner admin management (e2e)', () => {
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

  it('RBAC: a plain ADMIN cannot reach owner admin-management (403)', async () => {
    const { token } = await tokenFor(app, UserRole.ADMIN, '+919000000010');
    await request(app.getHttpServer())
      .get('/owner/admins')
      .set(...bearer(token))
      .expect(403);
  });

  it('owner invites → approves → the invited user becomes ADMIN; then revoke → CUSTOMER', async () => {
    const { token: ownerToken } = await tokenFor(app, UserRole.OWNER, '+919000000001');

    // Invite by phone.
    const invite = await request(app.getHttpServer())
      .post('/owner/admins/invite')
      .set(...bearer(ownerToken))
      .send({ phone: '+919888800001' })
      .expect(201);
    const inviteId = invite.body.inviteId as string;
    expect(invite.body.status).toBe('PENDING_OWNER_APPROVAL');

    // Invited user exists but is still CUSTOMER (not yet an admin).
    let user = await prisma.user.findUnique({ where: { phone: '+919888800001' } });
    expect(user?.role).toBe(UserRole.CUSTOMER);

    // Approve → becomes ADMIN.
    await request(app.getHttpServer())
      .post(`/owner/admins/${inviteId}/approve`)
      .set(...bearer(ownerToken))
      .expect(201);
    user = await prisma.user.findUnique({ where: { phone: '+919888800001' } });
    expect(user?.role).toBe(UserRole.ADMIN);

    // Revoke → back to CUSTOMER.
    await request(app.getHttpServer())
      .post(`/owner/admins/${inviteId}/revoke`)
      .set(...bearer(ownerToken))
      .expect(201);
    user = await prisma.user.findUnique({ where: { phone: '+919888800001' } });
    expect(user?.role).toBe(UserRole.CUSTOMER);
  });

  it('lists invites for the owner', async () => {
    const { token: ownerToken } = await tokenFor(app, UserRole.OWNER, '+919000000002');
    await request(app.getHttpServer())
      .post('/owner/admins/invite')
      .set(...bearer(ownerToken))
      .send({ phone: '+919888800002' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/owner/admins')
      .set(...bearer(ownerToken))
      .expect(200);
    expect(list.body.length).toBe(1);
    expect(list.body[0].phone).toBe('+919888800002');
  });
});
