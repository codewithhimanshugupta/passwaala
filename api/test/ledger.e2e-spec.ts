import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { LedgerEntryType, OrderStatus, UserRole } from '@passwaala/shared';
import { createTestApp } from './create-test-app';
import { closeDb, createOrder, createShop, prisma, resetDb } from './db';
import { bearer } from './auth';

async function shopkeeperToken(app: INestApplication, ownerId: string, shopId: string) {
  const jwt = app.get(JwtService);
  return jwt.signAsync({ sub: ownerId, role: UserRole.SHOPKEEPER, shopId });
}

/** Drive an order all the way to DELIVERED as the shopkeeper. */
async function deliver(app: INestApplication, token: string, orderId: string) {
  for (const status of [
    OrderStatus.ACCEPTED,
    OrderStatus.PREPARING,
    OrderStatus.READY,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERED,
  ]) {
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set(...bearer(token))
      .send({ status })
      .expect(200);
  }
}

/**
 * Ledger + credit limit (e2e) — the revenue engine. Verifies commission +
 * platform-fee accrual with GST on DELIVERED, the ₹500 credit-limit auto-pause,
 * and payment settlement reactivating the shop.
 */
describe('Ledger + credit limit (e2e)', () => {
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

  it('accrues COMMISSION + PLATFORM_FEE (with GST) on DELIVERED', async () => {
    // Shop with 2% commission (default), NOT in a commission holiday.
    const { ownerId, shopId } = await createShop({ isOpen: true });
    // Order value 100000 paise + ₹10 fee → originalTotal 101000.
    const { orderId } = await createOrder(shopId, { status: OrderStatus.PLACED });
    await prisma.order.update({
      where: { id: orderId },
      data: { originalTotalPaise: 101000, platformFeePaise: 1000, deliveryFeePaise: 0, commissionRateSnapshot: 0.02 },
    });
    const token = await shopkeeperToken(app, ownerId, shopId);

    await deliver(app, token, orderId);

    const ledger = await prisma.ledgerEntry.findMany({ where: { shopId }, orderBy: { type: 'asc' } });
    const commission = ledger.find((l) => l.type === LedgerEntryType.COMMISSION);
    const platform = ledger.find((l) => l.type === LedgerEntryType.PLATFORM_FEE);

    // Order value = 101000 - 1000 fee - 0 delivery = 100000. 2% = 2000 base.
    expect(commission?.basePaise).toBe(2000);
    expect(commission?.gstPaise).toBe(360); // 18%
    expect(commission?.totalPaise).toBe(2360);
    // Platform fee ₹10 = 1000 base + 180 GST = 1180.
    expect(platform?.basePaise).toBe(1000);
    expect(platform?.totalPaise).toBe(1180);
  });

  it('auto-pauses the shop when dues cross the ₹500 credit limit', async () => {
    const { ownerId, shopId } = await createShop({ isOpen: true });
    // creditLimit is ₹500 = 50000 paise (factory default). Make one big order.
    const { orderId } = await createOrder(shopId, { status: OrderStatus.PLACED });
    // Order value 2,000,000 paise (₹20k) → 2% = 40000 commission base + GST.
    await prisma.order.update({
      where: { id: orderId },
      data: { originalTotalPaise: 2001000, platformFeePaise: 1000, deliveryFeePaise: 0, commissionRateSnapshot: 0.02 },
    });
    const token = await shopkeeperToken(app, ownerId, shopId);

    await deliver(app, token, orderId);

    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    // Commission 40000 + GST 7200 = 47200; platform 1180 → dues 48380 < 50000.
    // Not yet paused. Deliver a second order to cross the limit.
    expect(shop?.outstandingDuesPaise).toBe(48380);
    expect(shop?.isOpen).toBe(true);

    const { orderId: o2 } = await createOrder(shopId, { status: OrderStatus.PLACED });
    await prisma.order.update({
      where: { id: o2 },
      data: { originalTotalPaise: 101000, platformFeePaise: 1000, deliveryFeePaise: 0, commissionRateSnapshot: 0.02 },
    });
    await deliver(app, token, o2);

    const paused = await prisma.shop.findUnique({ where: { id: shopId } });
    expect(paused?.outstandingDuesPaise).toBeGreaterThanOrEqual(50000);
    expect(paused?.isOpen).toBe(false); // auto-paused
  });

  it('does not accrue commission during the commission holiday (platform fee still applies)', async () => {
    const { ownerId, shopId } = await createShop({ isOpen: true });
    const future = new Date();
    future.setMonth(future.getMonth() + 1);
    await prisma.shop.update({ where: { id: shopId }, data: { commissionFreeUntil: future } });

    const { orderId } = await createOrder(shopId, { status: OrderStatus.PLACED });
    await prisma.order.update({
      where: { id: orderId },
      data: { originalTotalPaise: 101000, platformFeePaise: 1000, commissionRateSnapshot: 0.02 },
    });
    const token = await shopkeeperToken(app, ownerId, shopId);

    await deliver(app, token, orderId);

    const ledger = await prisma.ledgerEntry.findMany({ where: { shopId } });
    expect(ledger.find((l) => l.type === LedgerEntryType.COMMISSION)).toBeUndefined();
    expect(ledger.find((l) => l.type === LedgerEntryType.PLATFORM_FEE)).toBeDefined();
  });

  it('admin records payment → dues cleared, shop reactivated', async () => {
    const { shopId } = await createShop({ isOpen: false });
    await prisma.shop.update({ where: { id: shopId }, data: { outstandingDuesPaise: 60000 } });
    await prisma.ledgerEntry.create({
      data: { shopId, type: LedgerEntryType.COMMISSION, basePaise: 50000, gstPaise: 9000, totalPaise: 59000 },
    });

    const jwt = app.get(JwtService);
    const adminUser = await prisma.user.create({ data: { phone: '+919333333333', role: UserRole.ADMIN } });
    const adminToken = await jwt.signAsync({ sub: adminUser.id, role: UserRole.ADMIN });

    await request(app.getHttpServer())
      .post(`/ledger/record-payment/${shopId}`)
      .set(...bearer(adminToken))
      .expect(201);

    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    expect(shop?.outstandingDuesPaise).toBe(0);
    expect(shop?.isOpen).toBe(true);

    const entries = await prisma.ledgerEntry.findMany({ where: { shopId } });
    expect(entries.every((e) => e.status === 'PAID')).toBe(true);
  });

  it('shopkeeper reads their OWN ledger + dues summary', async () => {
    const { ownerId, shopId } = await createShop();
    await prisma.ledgerEntry.create({
      data: { shopId, type: LedgerEntryType.PLATFORM_FEE, basePaise: 1000, gstPaise: 180, totalPaise: 1180 },
    });
    const token = await shopkeeperToken(app, ownerId, shopId);

    const res = await request(app.getHttpServer())
      .get('/ledger')
      .set(...bearer(token))
      .expect(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.creditLimitPaise).toBe(50000);
  });

  it('surfaces the city collection UPI on the shopkeeper ledger summary', async () => {
    // Shop defaults to city "Jhansi"; configure PassWaala's collection UPI there.
    const { ownerId, shopId } = await createShop();
    await prisma.serviceableCity.upsert({
      where: { name: 'Jhansi' },
      create: { name: 'Jhansi', enabled: true, collectionUpiVpa: 'passwala@upi', collectionUpiName: 'PassWaala' },
      update: { collectionUpiVpa: 'passwala@upi', collectionUpiName: 'PassWaala', enabled: true },
    });
    const token = await shopkeeperToken(app, ownerId, shopId);

    const res = await request(app.getHttpServer())
      .get('/ledger')
      .set(...bearer(token))
      .expect(200);
    expect(res.body.collectionUpi).toEqual({ vpa: 'passwala@upi', name: 'PassWaala' });
  });

  it('shopkeeper pays exact dues → dues cleared, PAID + PAYMENT entries, reactivated', async () => {
    const { ownerId, shopId } = await createShop({ isOpen: false });
    await prisma.shop.update({ where: { id: shopId }, data: { outstandingDuesPaise: 60000 } });
    await prisma.ledgerEntry.create({
      data: { shopId, type: LedgerEntryType.COMMISSION, basePaise: 50000, gstPaise: 9000, totalPaise: 59000 },
    });
    const token = await shopkeeperToken(app, ownerId, shopId);

    const res = await request(app.getHttpServer())
      .post('/ledger/pay')
      .set(...bearer(token))
      .send({ amountPaise: 60000 })
      .expect(201);
    expect(res.body.newDuesPaise).toBe(0);

    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    expect(shop?.outstandingDuesPaise).toBe(0);
    expect(shop?.isOpen).toBe(true); // reactivated

    const entries = await prisma.ledgerEntry.findMany({ where: { shopId } });
    expect(entries.every((e) => e.status === 'PAID')).toBe(true);
    const payment = entries.find((e) => e.type === LedgerEntryType.PAYMENT);
    expect(payment?.totalPaise).toBe(-60000);
  });

  it('shopkeeper overpays → dues go NEGATIVE (advance credit); next accrual draws it down', async () => {
    const { ownerId, shopId } = await createShop({ isOpen: true });
    await prisma.shop.update({ where: { id: shopId }, data: { outstandingDuesPaise: 10000 } });
    const token = await shopkeeperToken(app, ownerId, shopId);

    // Pay ₹300 against ₹100 dues → −₹200 (20000 paise) advance credit.
    const res = await request(app.getHttpServer())
      .post('/ledger/pay')
      .set(...bearer(token))
      .send({ amountPaise: 30000 })
      .expect(201);
    expect(res.body.newDuesPaise).toBe(-20000);

    let shop = await prisma.shop.findUnique({ where: { id: shopId } });
    expect(shop?.outstandingDuesPaise).toBe(-20000);

    // A delivered order now accrues commission+fee; it should draw DOWN the credit
    // (dues rise from −20000 toward 0) rather than starting from 0.
    const { orderId } = await createOrder(shopId, { status: OrderStatus.PLACED });
    await prisma.order.update({
      where: { id: orderId },
      data: { originalTotalPaise: 101000, platformFeePaise: 1000, deliveryFeePaise: 0, commissionRateSnapshot: 0.02 },
    });
    await deliver(app, token, orderId);

    shop = await prisma.shop.findUnique({ where: { id: shopId } });
    // Started at −20000; accrual is positive, so dues must be greater than −20000
    // and still reflect the credit absorbing part of the charge.
    expect(shop!.outstandingDuesPaise).toBeGreaterThan(-20000);
    expect(shop!.outstandingDuesPaise).toBeLessThan(2380); // less than a from-zero accrual
  });

  it('rejects a non-positive payment amount (400)', async () => {
    const { ownerId, shopId } = await createShop({ isOpen: true });
    const token = await shopkeeperToken(app, ownerId, shopId);
    await request(app.getHttpServer())
      .post('/ledger/pay')
      .set(...bearer(token))
      .send({ amountPaise: 0 })
      .expect(400);
  });
});
