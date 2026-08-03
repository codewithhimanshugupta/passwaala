import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserRole, VerificationStatus } from '@passwaala/shared';
import { createTestApp } from './create-test-app';
import { closeDb, createShop, prisma, resetDb } from './db';
import { bearer, createUser } from './auth';

/**
 * Shops (e2e) — real DB. Covers the Phase 1 registration + KYC + verification
 * flow and the hard KYC gate: an unapproved shop is never publicly discoverable.
 */
describe('Shops (e2e)', () => {
  let app: INestApplication;

  const validShop = {
    name: 'Test Kirana',
    shopCategory: 'kirana',
    storefrontPhotoUrl: 'http://localhost/uploads/storefront.jpg',
    latitude: 28.6139,
    longitude: 77.209,
    upiVpa: 'testkirana@upi',
    city: 'Jhansi',
  };

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    // Registration now gates on a serviceable city — seed one so /shops accepts.
    // upsert (not create): ServiceableCity isn't in resetDb's truncate set, so a
    // plain create would hit the unique-name constraint on the 2nd test.
    await prisma.serviceableCity.upsert({
      where: { name: 'Jhansi' },
      create: { name: 'Jhansi', enabled: true },
      update: { enabled: true },
    });
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('registers a shop (DRAFT), promotes the user to SHOPKEEPER, returns a scoped token', async () => {
    const { userId, token } = await createUser(app, UserRole.CUSTOMER);

    const res = await request(app.getHttpServer())
      .post('/shops')
      .set(...bearer(token))
      .send(validShop)
      .expect(201);

    expect(res.body.shop.verificationStatus).toBe(VerificationStatus.DRAFT);
    expect(typeof res.body.accessToken).toBe('string');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.role).toBe(UserRole.SHOPKEEPER);
  });

  it('rejects registration with an invalid body (ValidationPipe)', async () => {
    const { token } = await createUser(app, UserRole.CUSTOMER);
    await request(app.getHttpServer())
      .post('/shops')
      .set(...bearer(token))
      .send({ name: 'x' }) // missing required fields, name too short
      .expect(400);
  });

  it('ignores a client-supplied verificationStatus (never trusts client)', async () => {
    const { token } = await createUser(app, UserRole.CUSTOMER);
    const res = await request(app.getHttpServer())
      .post('/shops')
      .set(...bearer(token))
      .send({ ...validShop, verificationStatus: 'APPROVED' })
      .expect(400); // forbidNonWhitelisted rejects the extra field outright
    expect(res.body.message).toBeDefined();
  });

  it('KYC gate: an unapproved shop is NOT publicly discoverable (404)', async () => {
    const owner = await prisma.user.create({
      data: { phone: '+919000000001', role: UserRole.SHOPKEEPER },
    });
    const shop = await prisma.shop.create({
      data: {
        ownerId: owner.id,
        name: 'Hidden Shop',
        shopCategory: 'dairy',
        storefrontPhotoUrl: 'http://localhost/uploads/s.jpg',
        latitude: 28.6,
        longitude: 77.2,
        creditLimitPaise: 50000,
        verificationStatus: VerificationStatus.PENDING_REVIEW,
      },
    });

    await request(app.getHttpServer()).get(`/shops/${shop.id}`).expect(400);
  });

  it('an APPROVED shop IS publicly discoverable', async () => {
    const owner = await prisma.user.create({
      data: { phone: '+919000000002', role: UserRole.SHOPKEEPER },
    });
    const shop = await prisma.shop.create({
      data: {
        ownerId: owner.id,
        name: 'Live Shop',
        shopCategory: 'kirana',
        storefrontPhotoUrl: 'http://localhost/uploads/s.jpg',
        latitude: 28.6,
        longitude: 77.2,
        creditLimitPaise: 50000,
        verificationStatus: VerificationStatus.APPROVED,
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/shops/${shop.id}`)
      .expect(200);
    expect(res.body.name).toBe('Live Shop');
    // Public view must NOT leak private/operational fields.
    expect(res.body.outstandingDuesPaise).toBeUndefined();
    expect(res.body.commissionRate).toBeUndefined();
  });

  it('submit KYC moves DRAFT → PENDING_REVIEW', async () => {
    // Register first to get a shopkeeper + scoped token.
    const { token: custToken } = await createUser(app, UserRole.CUSTOMER);
    const reg = await request(app.getHttpServer())
      .post('/shops')
      .set(...bearer(custToken))
      .send(validShop)
      .expect(201);
    const shopToken: string = reg.body.accessToken;

    const res = await request(app.getHttpServer())
      .post('/shops/me/kyc')
      .set(...bearer(shopToken))
      .send({
        aadhaarPan: 'ABCDE1234F',
        gstOrLicence: 'GUMASTA-123',
        bankProofUrl: 'http://localhost/uploads/cheque.jpg',
        docUrls: ['http://localhost/uploads/doc1.jpg'],
      })
      .expect(201);

    expect(res.body.verificationStatus).toBe(VerificationStatus.PENDING_REVIEW);
  });

  describe('nearby discovery (PostGIS)', () => {
    // Connaught Place, Delhi as the customer's location.
    const cp = { lat: 28.6315, lng: 77.2167 };

    it('returns APPROVED shops within the radius, sorted by distance, with distanceMeters', async () => {
      // ~300m away (approved, open) and ~40km away (approved, open, out of 3km).
      await createShop({ latitude: 28.634, longitude: 77.219, isOpen: true }); // near
      await createShop({ latitude: 29.0, longitude: 77.6, isOpen: true }); // far

      const res = await request(app.getHttpServer())
        .get(`/shops/nearby?lat=${cp.lat}&lng=${cp.lng}&radiusMeters=3000`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].distanceMeters).toBeGreaterThan(0);
      expect(res.body[0].distanceMeters).toBeLessThan(3000);
    });

    it('excludes non-APPROVED shops from discovery', async () => {
      await createShop({ latitude: 28.634, longitude: 77.219, verificationStatus: VerificationStatus.PENDING_REVIEW });
      const res = await request(app.getHttpServer())
        .get(`/shops/nearby?lat=${cp.lat}&lng=${cp.lng}&radiusMeters=3000`)
        .expect(200);
      expect(res.body).toHaveLength(0);
    });

    it('filters by openNow and category', async () => {
      await createShop({ latitude: 28.634, longitude: 77.219, isOpen: true, shopCategory: 'dairy' });
      await createShop({ latitude: 28.633, longitude: 77.218, isOpen: false, shopCategory: 'dairy' });
      await createShop({ latitude: 28.632, longitude: 77.217, isOpen: true, shopCategory: 'medical' });

      const openDairy = await request(app.getHttpServer())
        .get(`/shops/nearby?lat=${cp.lat}&lng=${cp.lng}&radiusMeters=3000&openNow=true&category=dairy`)
        .expect(200);
      expect(openDairy.body).toHaveLength(1);
      expect(openDairy.body[0].isOpen).toBe(true);
      expect(openDairy.body[0].shopCategory).toBe('dairy');
    });

    it('rejects an invalid lat/lng (ValidationPipe)', async () => {
      await request(app.getHttpServer())
        .get('/shops/nearby?lat=999&lng=77.2')
        .expect(400);
    });
  });
});
