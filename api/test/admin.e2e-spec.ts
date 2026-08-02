import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { LedgerEntryType, UserRole, VerificationStatus } from '@passwaala/shared';
import { createTestApp } from './create-test-app';
import { closeDb, createShop, prisma, resetDb } from './db';
import { bearer } from './auth';

async function tokenFor(app: INestApplication, role: UserRole): Promise<string> {
  const jwt = app.get(JwtService);
  const user = await prisma.user.create({
    data: { phone: `+9195${Math.floor(1000000 + Math.random() * 8999999)}`, role },
  });
  return jwt.signAsync({ sub: user.id, role });
}

/**
 * Admin (e2e) — real DB. Covers the KYC-review lifecycle (approve/reject/
 * suspend), the onboarding-fee ledger write on approval, and RBAC: non-admins
 * are denied the admin surface entirely.
 */
describe('Admin (e2e)', () => {
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

  it('RBAC: a SHOPKEEPER cannot reach the admin surface (403)', async () => {
    const token = await tokenFor(app, UserRole.SHOPKEEPER);
    await request(app.getHttpServer())
      .get('/admin/shops/pending')
      .set(...bearer(token))
      .expect(403);
  });

  it('RBAC: a CUSTOMER cannot reach the admin surface (403)', async () => {
    const token = await tokenFor(app, UserRole.CUSTOMER);
    await request(app.getHttpServer())
      .get('/admin/shops/pending')
      .set(...bearer(token))
      .expect(403);
  });

  it('lists pending shops and approves one (holiday + onboarding fee ledger)', async () => {
    const adminToken = await tokenFor(app, UserRole.ADMIN);
    const { shopId } = await createShop({ verificationStatus: VerificationStatus.PENDING_REVIEW });

    const pending = await request(app.getHttpServer())
      .get('/admin/shops/pending')
      .set(...bearer(adminToken))
      .expect(200);
    expect(pending.body.map((s: { id: string }) => s.id)).toContain(shopId);

    const res = await request(app.getHttpServer())
      .post(`/admin/shops/${shopId}/approve`)
      .set(...bearer(adminToken))
      .expect(201);
    expect(res.body.verificationStatus).toBe(VerificationStatus.APPROVED);

    // Commission holiday set. Onboarding fee is recorded as PAID upfront and
    // does NOT add to outstanding dues (paid directly to PassWaala at approval).
    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    expect(shop?.commissionFreeUntil).not.toBeNull();
    expect(shop?.outstandingDuesPaise).toBe(0);

    const ledger = await prisma.ledgerEntry.findMany({ where: { shopId } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].type).toBe(LedgerEntryType.ONBOARDING_FEE);
    expect(ledger[0].status).toBe('PAID');
    // ₹499 = 49900 base + 18% GST = 8982 → 58882 total.
    expect(ledger[0].basePaise).toBe(49900);
    expect(ledger[0].gstPaise).toBe(8982);
    expect(ledger[0].totalPaise).toBe(58882);
  });

  it('rejects a pending shop with a reason (required)', async () => {
    const adminToken = await tokenFor(app, UserRole.ADMIN);
    const { shopId } = await createShop({ verificationStatus: VerificationStatus.PENDING_REVIEW });

    // No reason → 400.
    await request(app.getHttpServer())
      .post(`/admin/shops/${shopId}/reject`)
      .set(...bearer(adminToken))
      .send({})
      .expect(400);

    const res = await request(app.getHttpServer())
      .post(`/admin/shops/${shopId}/reject`)
      .set(...bearer(adminToken))
      .send({ reason: 'Storefront photo unclear' })
      .expect(201);
    expect(res.body.verificationStatus).toBe(VerificationStatus.REJECTED);
  });

  it('suspends an approved shop (instantly hidden from discovery)', async () => {
    const adminToken = await tokenFor(app, UserRole.ADMIN);
    const { shopId } = await createShop({ verificationStatus: VerificationStatus.APPROVED });

    await request(app.getHttpServer())
      .post(`/admin/shops/${shopId}/suspend`)
      .set(...bearer(adminToken))
      .expect(201);

    // Suspended shop is no longer publicly discoverable.
    await request(app.getHttpServer()).get(`/shops/${shopId}`).expect(400);
  });

  it('views a shop’s KYC (admin-only crown-jewels access)', async () => {
    const adminToken = await tokenFor(app, UserRole.ADMIN);
    const { shopId } = await createShop({ verificationStatus: VerificationStatus.PENDING_REVIEW });
    await prisma.shopKyc.create({
      data: {
        shopId,
        aadhaarPan: 'ABCDE1234F',
        gstOrLicence: 'GST-123',
        bankProofUrl: 'http://localhost/uploads/cheque.jpg',
        docUrls: ['http://localhost/uploads/doc1.jpg'],
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/admin/shops/${shopId}/kyc`)
      .set(...bearer(adminToken))
      .expect(200);
    expect(res.body.aadhaarPan).toBe('ABCDE1234F');
  });
});
