import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DeliveryMode, OrderStatus, PaymentMethod, UserRole } from '@passwaala/shared';
import { createTestApp } from './create-test-app';
import { closeDb, createProduct, createShop, prisma, resetDb } from './db';
import { bearer, createUser } from './auth';
import { DispatchService } from '../src/dispatch/dispatch.service';

/**
 * Rider platform-delivery flow (e2e): register rider → go online → a
 * PLATFORM_RIDER order becomes READY → proximity dispatch offers it → rider
 * accepts → completes with the customer's handoff OTP → earnings credited.
 */
describe('Rider delivery (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let dispatch: DispatchService;

  beforeAll(async () => {
    app = await createTestApp();
    jwt = app.get(JwtService);
    dispatch = app.get(DispatchService);
  });
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  async function shopkeeperToken(ownerId: string, shopId: string) {
    return jwt.signAsync({ sub: ownerId, role: UserRole.SHOPKEEPER, shopId });
  }

  /** Register an online rider AT a given position; returns id + token. */
  async function makeRider(phoneSuffix: string, lat: number, lng: number) {
    const { userId } = await createUser(app, UserRole.CUSTOMER);
    await prisma.user.update({ where: { id: userId }, data: { role: UserRole.RIDER } });
    await prisma.riderProfile.create({ data: { userId, online: true, latitude: lat, longitude: lng } });
    const token = await jwt.signAsync({ sub: userId, role: UserRole.RIDER });
    return { riderId: userId, token };
  }

  it('registers a rider and returns a RIDER-scoped token', async () => {
    const { token } = await createUser(app, UserRole.CUSTOMER);
    const res = await request(app.getHttpServer())
      .post('/riders/register')
      .set(...bearer(token))
      .send({ name: 'Ravi Rider', vehicle: 'Bike' })
      .expect(201);
    expect(typeof res.body.accessToken).toBe('string');
    const payload = jwt.verify<{ role: string }>(res.body.accessToken);
    expect(payload.role).toBe(UserRole.RIDER);
  });

  it('full flow: online → offered nearest → accept → pickup OTP → deliver OTP → earnings', async () => {
    // A shop + a PLATFORM_RIDER order that's READY with both OTPs.
    const { shopId } = await createShop({ isOpen: true }); // shop at (28.6, 77.2)
    // A rider online at the shop's location so dispatch offers it to them.
    const { riderId, token: riderToken } = await makeRider('r1', 28.6, 77.2);
    const customer = await prisma.user.create({ data: { phone: '+919000012345', role: UserRole.CUSTOMER } });
    const { productId } = await createProduct(shopId, { pricePaise: 5000, stock: 5 });
    const order = await prisma.order.create({
      data: {
        customerId: customer.id, shopId, status: OrderStatus.READY,
        paymentMethod: PaymentMethod.COD, deliveryMode: DeliveryMode.PLATFORM_RIDER,
        originalTotalPaise: 6180, platformFeePaise: 1180, deliveryFeePaise: 3000, idempotencyKey: 'rider-1',
        pickupOtp: '5678', riderPickupOtp: '4321',
        items: { create: [{ productId, nameSnapshot: 'X', pricePaiseSnapshot: 5000, qty: 1 }] },
      },
    });

    // Dispatch offers the READY order to the nearest online rider.
    const offered = await dispatch.startForOrder(order.id);
    expect(offered).toBe(riderId);

    // Rider sees their offer.
    const jobs = await request(app.getHttpServer()).get('/riders/jobs').set(...bearer(riderToken)).expect(200);
    expect(jobs.body.map((o: { id: string }) => o.id)).toContain(order.id);

    // Claim it → RIDER_ASSIGNED (not out for delivery yet), assigned to rider.
    await request(app.getHttpServer()).post(`/riders/jobs/${order.id}/accept`).set(...bearer(riderToken)).expect(201);
    let row = await prisma.order.findUnique({ where: { id: order.id } });
    expect(row?.status).toBe(OrderStatus.RIDER_ASSIGNED);
    expect(row?.riderId).toBe(riderId);
    expect(row?.offeredRiderId).toBeNull(); // offer cleared on accept

    // Confirm pickup: wrong/absent OTP → 400; correct shop pickup OTP → OUT_FOR_DELIVERY.
    await request(app.getHttpServer()).post(`/riders/deliveries/${order.id}/pickup`).set(...bearer(riderToken)).send({ otp: '0000' }).expect(400);
    await request(app.getHttpServer()).post(`/riders/deliveries/${order.id}/pickup`).set(...bearer(riderToken)).send({ otp: '4321' }).expect(201);
    row = await prisma.order.findUnique({ where: { id: order.id } });
    expect(row?.status).toBe(OrderStatus.OUT_FOR_DELIVERY);

    // Can't complete before pickup would have been blocked; now complete WITHOUT
    // otp → 400; with the customer handoff otp → 201 + earnings.
    await request(app.getHttpServer()).post(`/riders/deliveries/${order.id}/complete`).set(...bearer(riderToken)).send({}).expect(400);
    await request(app.getHttpServer()).post(`/riders/deliveries/${order.id}/complete`).set(...bearer(riderToken)).send({ otp: '5678' }).expect(201);

    row = await prisma.order.findUnique({ where: { id: order.id } });
    expect(row?.status).toBe(OrderStatus.DELIVERED);
    const profile = await prisma.riderProfile.findUnique({ where: { userId: riderId } });
    expect(profile?.earningsPaise).toBe(3000);
  });

  it('offline rider sees no jobs; a claimed job can’t be double-claimed', async () => {
    const { userId: riderId } = await createUser(app, UserRole.CUSTOMER);
    await prisma.user.update({ where: { id: riderId }, data: { role: UserRole.RIDER } });
    await prisma.riderProfile.create({ data: { userId: riderId, online: false } });
    const riderToken = await jwt.signAsync({ sub: riderId, role: UserRole.RIDER });

    const jobs = await request(app.getHttpServer()).get('/riders/jobs').set(...bearer(riderToken)).expect(200);
    expect(jobs.body).toHaveLength(0); // offline → no jobs
  });

  it('active-order cap: a rider holds up to 2 orders (any drop distance), the 3rd is blocked', async () => {
    const { shopId } = await createShop({ isOpen: true }); // (28.6, 77.2)
    const { riderId, token: riderToken } = await makeRider('cap', 28.6, 77.2);
    const customer = await prisma.user.create({ data: { phone: '+919000099999', role: UserRole.CUSTOMER } });
    const { productId } = await createProduct(shopId, { pricePaise: 5000, stock: 50 });

    let seq = 0;
    const makeOrder = async (lat: number, lng: number) => {
      const addr = await prisma.address.create({
        data: { userId: customer.id, line: `Drop ${seq}`, latitude: lat, longitude: lng, label: 'Home' },
      });
      seq += 1;
      return prisma.order.create({
        data: {
          customerId: customer.id, shopId, status: OrderStatus.READY,
          paymentMethod: PaymentMethod.COD, deliveryMode: DeliveryMode.PLATFORM_RIDER,
          originalTotalPaise: 6180, platformFeePaise: 1180, idempotencyKey: `cap-${seq}`,
          pickupOtp: '1111', riderPickupOtp: '2222', addressId: addr.id,
          items: { create: [{ productId, nameSnapshot: 'X', pricePaiseSnapshot: 5000, qty: 1 }] },
        },
      });
    };

    // Two orders with FAR-APART drops — the old 1km batching cap would have
    // blocked the 2nd; with dispatch it's allowed (only the count cap applies).
    const a = await makeOrder(28.600, 77.200);
    const b = await makeOrder(28.900, 77.500); // ~40km from a's drop
    const c = await makeOrder(28.610, 77.210);

    // Each must be offered to this rider before they can accept it.
    await dispatch.startForOrder(a.id);
    await request(app.getHttpServer()).post(`/riders/jobs/${a.id}/accept`).set(...bearer(riderToken)).expect(201);
    await dispatch.startForOrder(b.id);
    await request(app.getHttpServer()).post(`/riders/jobs/${b.id}/accept`).set(...bearer(riderToken)).expect(201);

    // 3rd → blocked at the active-order cap (2), even though it's offered.
    await dispatch.startForOrder(c.id);
    await request(app.getHttpServer()).post(`/riders/jobs/${c.id}/accept`).set(...bearer(riderToken)).expect(400);

    const aRow = await prisma.order.findUnique({ where: { id: a.id } });
    const bRow = await prisma.order.findUnique({ where: { id: b.id } });
    expect(aRow?.status).toBe(OrderStatus.RIDER_ASSIGNED);
    expect(bRow?.status).toBe(OrderStatus.RIDER_ASSIGNED);
    expect(bRow?.riderId).toBe(riderId); // far-apart 2nd order allowed
  });

  it('proximity dispatch: offered to nearest first; on timeout re-offers to the next; widens rings; then opens board', async () => {
    const { shopId } = await createShop({ isOpen: true }); // (28.6, 77.2)
    // Near rider (~1.1km, within the 2km ring) and a far rider (~8km, needs 10km ring).
    const near = await makeRider('near', 28.61, 77.2);
    const far = await makeRider('far', 28.672, 77.2);
    const customer = await prisma.user.create({ data: { phone: '+919000055555', role: UserRole.CUSTOMER } });
    const { productId } = await createProduct(shopId, { pricePaise: 5000, stock: 50 });
    const order = await prisma.order.create({
      data: {
        customerId: customer.id, shopId, status: OrderStatus.READY,
        paymentMethod: PaymentMethod.COD, deliveryMode: DeliveryMode.PLATFORM_RIDER,
        originalTotalPaise: 6180, platformFeePaise: 1180, idempotencyKey: 'disp-1',
        pickupOtp: '5678', riderPickupOtp: '4321',
      },
    });

    // First offer → the NEAR rider (ring 2km); the far rider can't see it yet.
    const first = await dispatch.startForOrder(order.id);
    expect(first).toBe(near.riderId);
    let farJobs = await request(app.getHttpServer()).get('/riders/jobs').set(...bearer(far.token)).expect(200);
    expect(farJobs.body).toHaveLength(0);

    // Near rider lets the offer lapse → the sweep re-offers. Next candidate in
    // the 2km ring is none, so it widens to reach the FAR rider.
    await prisma.order.update({ where: { id: order.id }, data: { offerExpiresAt: new Date(Date.now() - 1000) } });
    await dispatch.tick();
    let row = await prisma.order.findUnique({ where: { id: order.id } });
    expect(row?.offeredRiderId).toBe(far.riderId);
    expect(row?.dispatchRadiusMeters).toBe(10000);
    expect(row?.dispatchTriedRiderIds).toEqual(expect.arrayContaining([near.riderId, far.riderId]));
    farJobs = await request(app.getHttpServer()).get('/riders/jobs').set(...bearer(far.token)).expect(200);
    expect(farJobs.body.map((o: { id: string }) => o.id)).toContain(order.id);

    // Far rider also lapses → no untried candidate in any ring → open board.
    await prisma.order.update({ where: { id: order.id }, data: { offerExpiresAt: new Date(Date.now() - 1000) } });
    await dispatch.tick();
    row = await prisma.order.findUnique({ where: { id: order.id } });
    expect(row?.dispatchExhausted).toBe(true);
    expect(row?.offeredRiderId).toBeNull();

    // On the open board any online rider (even the near one) can grab it.
    await request(app.getHttpServer()).post(`/riders/jobs/${order.id}/accept`).set(...bearer(near.token)).expect(201);
    row = await prisma.order.findUnique({ where: { id: order.id } });
    expect(row?.status).toBe(OrderStatus.RIDER_ASSIGNED);
    expect(row?.riderId).toBe(near.riderId);
  });

  it('decline re-offers to the next-nearest rider', async () => {
    const { shopId } = await createShop({ isOpen: true });
    const a = await makeRider('a', 28.605, 77.2); // ~0.55km
    const b = await makeRider('b', 28.612, 77.2); // ~1.3km
    const customer = await prisma.user.create({ data: { phone: '+919000044444', role: UserRole.CUSTOMER } });
    const { productId } = await createProduct(shopId, { pricePaise: 5000, stock: 50 });
    const order = await prisma.order.create({
      data: {
        customerId: customer.id, shopId, status: OrderStatus.READY,
        paymentMethod: PaymentMethod.COD, deliveryMode: DeliveryMode.PLATFORM_RIDER,
        originalTotalPaise: 6180, platformFeePaise: 1180, idempotencyKey: 'decl-1',
        pickupOtp: '5678', riderPickupOtp: '4321',
      },
    });

    const first = await dispatch.startForOrder(order.id);
    expect(first).toBe(a.riderId); // nearest
    // A declines → re-offered to B.
    await request(app.getHttpServer()).post(`/riders/jobs/${order.id}/decline`).set(...bearer(a.token)).expect(201);
    const row = await prisma.order.findUnique({ where: { id: order.id } });
    expect(row?.offeredRiderId).toBe(b.riderId);
    // A can no longer accept it (not their offer); B can.
    await request(app.getHttpServer()).post(`/riders/jobs/${order.id}/accept`).set(...bearer(a.token)).expect(400);
    await request(app.getHttpServer()).post(`/riders/jobs/${order.id}/accept`).set(...bearer(b.token)).expect(201);
  });

  it('COD dues: delivering a COD order adds its total to dues; at cap accept is blocked; admin clears', async () => {
    const { shopId } = await createShop({ isOpen: true });
    const { riderId, token: riderToken } = await makeRider('cod', 28.6, 77.2);
    const customer = await prisma.user.create({ data: { phone: '+919000088888', role: UserRole.CUSTOMER } });
    const { productId } = await createProduct(shopId, { pricePaise: 5000, stock: 50 });
    const addr = await prisma.address.create({
      data: { userId: customer.id, line: 'Drop', latitude: 28.6, longitude: 77.2, label: 'Home' },
    });
    const makeCod = (key: string) =>
      prisma.order.create({
        data: {
          customerId: customer.id, shopId, status: OrderStatus.READY,
          paymentMethod: PaymentMethod.COD, deliveryMode: DeliveryMode.PLATFORM_RIDER,
          originalTotalPaise: 6180, platformFeePaise: 1180, idempotencyKey: key,
          pickupOtp: '5678', riderPickupOtp: '4321', addressId: addr.id,
          items: { create: [{ productId, nameSnapshot: 'X', pricePaiseSnapshot: 5000, qty: 1 }] },
        },
      });

    // Accept → pickup → deliver a COD order. Dues should rise by the order total.
    const o1 = await makeCod('cod-1');
    await dispatch.startForOrder(o1.id);
    await request(app.getHttpServer()).post(`/riders/jobs/${o1.id}/accept`).set(...bearer(riderToken)).expect(201);
    await request(app.getHttpServer()).post(`/riders/deliveries/${o1.id}/pickup`).set(...bearer(riderToken)).send({ otp: '4321' }).expect(201);
    await request(app.getHttpServer()).post(`/riders/deliveries/${o1.id}/complete`).set(...bearer(riderToken)).send({ otp: '5678' }).expect(201);

    let profile = await prisma.riderProfile.findUnique({ where: { userId: riderId } });
    expect(profile?.duesPaise).toBe(6180);

    // Push dues to the cap and confirm accept is now blocked.
    await prisma.riderProfile.update({ where: { userId: riderId }, data: { duesPaise: 50000 } });
    const o2 = await makeCod('cod-2');
    await dispatch.startForOrder(o2.id);
    await request(app.getHttpServer()).post(`/riders/jobs/${o2.id}/accept`).set(...bearer(riderToken)).expect(400);

    // Admin records the deposit → dues cleared → accept works again.
    const admin = await prisma.user.create({ data: { phone: '+919000077777', role: UserRole.ADMIN } });
    const adminToken = await jwt.signAsync({ sub: admin.id, role: UserRole.ADMIN });
    await request(app.getHttpServer()).post(`/admin/riders/${riderId}/record-payment`).set(...bearer(adminToken)).expect(201);
    profile = await prisma.riderProfile.findUnique({ where: { userId: riderId } });
    expect(profile?.duesPaise).toBe(0);
    // Re-offer o2 (its offer expired while dues were over the cap) then accept.
    await prisma.order.update({ where: { id: o2.id }, data: { offeredRiderId: null, offerExpiresAt: null, dispatchTriedRiderIds: [] } });
    await dispatch.startForOrder(o2.id);
    await request(app.getHttpServer()).post(`/riders/jobs/${o2.id}/accept`).set(...bearer(riderToken)).expect(201);
  });

  it('UPI delivery adds no dues', async () => {
    const { shopId } = await createShop({ isOpen: true });
    const { riderId, token: riderToken } = await makeRider('upi', 28.6, 77.2);
    const customer = await prisma.user.create({ data: { phone: '+919000066666', role: UserRole.CUSTOMER } });
    const { productId } = await createProduct(shopId, { pricePaise: 5000, stock: 50 });
    const addr = await prisma.address.create({
      data: { userId: customer.id, line: 'Drop', latitude: 28.6, longitude: 77.2, label: 'Home' },
    });
    const o = await prisma.order.create({
      data: {
        customerId: customer.id, shopId, status: OrderStatus.READY,
        paymentMethod: PaymentMethod.UPI_DIRECT, deliveryMode: DeliveryMode.PLATFORM_RIDER,
        originalTotalPaise: 6180, platformFeePaise: 1180, idempotencyKey: 'upi-1',
        pickupOtp: '5678', riderPickupOtp: '4321', addressId: addr.id,
        items: { create: [{ productId, nameSnapshot: 'X', pricePaiseSnapshot: 5000, qty: 1 }] },
      },
    });
    await dispatch.startForOrder(o.id);
    await request(app.getHttpServer()).post(`/riders/jobs/${o.id}/accept`).set(...bearer(riderToken)).expect(201);
    await request(app.getHttpServer()).post(`/riders/deliveries/${o.id}/pickup`).set(...bearer(riderToken)).send({ otp: '4321' }).expect(201);
    await request(app.getHttpServer()).post(`/riders/deliveries/${o.id}/complete`).set(...bearer(riderToken)).send({ otp: '5678' }).expect(201);
    const profile = await prisma.riderProfile.findUnique({ where: { userId: riderId } });
    expect(profile?.duesPaise).toBe(0);
  });

  it('COD paid by QR: rider blocked until shop confirms receipt; then no dues', async () => {
    const { ownerId, shopId } = await createShop({ isOpen: true });
    const { riderId, token: riderToken } = await makeRider('codqr', 28.6, 77.2);
    const customer = await prisma.user.create({ data: { phone: '+919000033333', role: UserRole.CUSTOMER } });
    const { productId } = await createProduct(shopId, { pricePaise: 5000, stock: 50 });
    const addr = await prisma.address.create({
      data: { userId: customer.id, line: 'Drop', latitude: 28.6, longitude: 77.2, label: 'Home' },
    });
    const o = await prisma.order.create({
      data: {
        customerId: customer.id, shopId, status: OrderStatus.READY,
        paymentMethod: PaymentMethod.COD, deliveryMode: DeliveryMode.PLATFORM_RIDER,
        originalTotalPaise: 6180, platformFeePaise: 1180, idempotencyKey: 'codqr-1',
        pickupOtp: '5678', riderPickupOtp: '4321', addressId: addr.id,
        items: { create: [{ productId, nameSnapshot: 'X', pricePaiseSnapshot: 5000, qty: 1 }] },
      },
    });
    await dispatch.startForOrder(o.id);
    await request(app.getHttpServer()).post(`/riders/jobs/${o.id}/accept`).set(...bearer(riderToken)).expect(201);
    await request(app.getHttpServer()).post(`/riders/deliveries/${o.id}/pickup`).set(...bearer(riderToken)).send({ otp: '4321' }).expect(201);

    // Rider tries to complete as QR-paid BEFORE the shop confirms → blocked (400).
    await request(app.getHttpServer())
      .post(`/riders/deliveries/${o.id}/complete`)
      .set(...bearer(riderToken))
      .send({ otp: '5678', codPaidViaUpi: true })
      .expect(400);

    // Rider claims the customer paid by UPI.
    await request(app.getHttpServer()).post(`/riders/deliveries/${o.id}/claim-upi`).set(...bearer(riderToken)).expect(201);
    let row = await prisma.order.findUnique({ where: { id: o.id } });
    expect(row?.codUpiClaimedAt).toBeTruthy();
    expect(row?.paymentConfirmed).toBe(false);

    // Still blocked until the shop confirms receipt.
    await request(app.getHttpServer())
      .post(`/riders/deliveries/${o.id}/complete`)
      .set(...bearer(riderToken))
      .send({ otp: '5678', codPaidViaUpi: true })
      .expect(400);

    // Shopkeeper confirms the UPI money arrived (no status change).
    const shopToken = await shopkeeperToken(ownerId, shopId);
    await request(app.getHttpServer()).post(`/orders/${o.id}/cod-upi-received`).set(...bearer(shopToken)).expect(201);
    row = await prisma.order.findUnique({ where: { id: o.id } });
    expect(row?.paymentConfirmed).toBe(true);
    expect(row?.status).toBe(OrderStatus.OUT_FOR_DELIVERY);

    // Now the rider can complete → delivered, NO dues (money went to the shop).
    await request(app.getHttpServer())
      .post(`/riders/deliveries/${o.id}/complete`)
      .set(...bearer(riderToken))
      .send({ otp: '5678', codPaidViaUpi: true })
      .expect(201);
    const profile = await prisma.riderProfile.findUnique({ where: { userId: riderId } });
    expect(profile?.duesPaise).toBe(0);
    row = await prisma.order.findUnique({ where: { id: o.id } });
    expect(row?.status).toBe(OrderStatus.DELIVERED);
  });
});
