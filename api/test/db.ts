import { PrismaClient } from '@prisma/client';
import {
  DeliveryMode,
  OrderStatus,
  PaymentMethod,
  UserRole,
  VerificationStatus,
} from '@nearbaz/shared';

/**
 * Shared Prisma client for integration tests, plus a truncation helper to reset
 * state between test cases (plan → Testing Standard: real Postgres test DB).
 *
 * resetDb() TRUNCATEs every application table with RESTART IDENTITY CASCADE, so
 * each test starts from a clean, isolated slate. It deliberately skips PostGIS's
 * spatial_ref_sys and Prisma's _prisma_migrations bookkeeping tables.
 */
export const prisma = new PrismaClient();

/** Application tables to truncate between tests (order-independent — CASCADE). */
const APP_TABLES = [
  'LedgerEntry',
  'Review',
  'OrderItem',
  'Order',
  'CartItem',
  'Cart',
  'Product',
  'Category',
  'ShopKyc',
  'Shop',
  'Address',
  'Referral',
  'AdminInvite',
  'User',
];

/** Truncate all application tables, resetting to an empty state. */
export async function resetDb(): Promise<void> {
  const list = APP_TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`,
  );
}

/** Close the shared client (call in afterAll). */
export async function closeDb(): Promise<void> {
  await prisma.$disconnect();
}

let shopCounter = 0;

/**
 * Create a shop owner (SHOPKEEPER) + their shop directly in the DB, for tests
 * that need an existing shop. Returns the ownerId + shopId.
 */
export async function createShop(
  opts: { verificationStatus?: VerificationStatus; latitude?: number; longitude?: number; isOpen?: boolean; shopCategory?: string; avgRating?: number } = {},
): Promise<{ ownerId: string; shopId: string }> {
  shopCounter += 1;
  const latitude = opts.latitude ?? 28.6;
  const longitude = opts.longitude ?? 77.2;
  const owner = await prisma.user.create({
    data: { phone: `+9197000${String(shopCounter).padStart(5, '0')}`, role: UserRole.SHOPKEEPER },
  });
  const shop = await prisma.shop.create({
    data: {
      ownerId: owner.id,
      name: `Shop ${shopCounter}`,
      shopCategory: opts.shopCategory ?? 'kirana',
      storefrontPhotoUrl: 'http://localhost/uploads/s.jpg',
      latitude,
      longitude,
      isOpen: opts.isOpen ?? false,
      avgRating: opts.avgRating ?? 0,
      creditLimitPaise: 50000,
      verificationStatus: opts.verificationStatus ?? VerificationStatus.APPROVED,
    },
  });
  // Populate the PostGIS geog point so nearby (ST_DWithin) can find it.
  await prisma.$executeRawUnsafe(
    `UPDATE "Shop" SET geog = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE id = $3`,
    longitude,
    latitude,
    shop.id,
  );
  return { ownerId: owner.id, shopId: shop.id };
}

/**
 * Create an address for a user directly. Returns the addressId.
 */
export async function createAddress(userId: string): Promise<{ addressId: string }> {
  const address = await prisma.address.create({
    data: {
      userId,
      line: '123 Test St',
      latitude: 28.6,
      longitude: 77.2,
      label: 'Home',
    },
  });
  return { addressId: address.id };
}

let orderCounter = 0;

/**
 * Create a product in a shop directly. Returns the productId.
 */
export async function createProduct(
  shopId: string,
  opts: { pricePaise?: number; stock?: number; available?: boolean; name?: string } = {},
): Promise<{ productId: string }> {
  const product = await prisma.product.create({
    data: {
      shopId,
      name: opts.name ?? 'Test Product',
      pricePaise: opts.pricePaise ?? 5000,
      mrpPaise: opts.pricePaise ?? 5000,
      stock: opts.stock ?? 10,
      available: opts.available ?? true,
    },
  });
  return { productId: product.id };
}

/**
 * Create a customer + a PLACED order for a shop directly in the DB, for tests
 * that need an existing order before customer order placement exists (Phase 3).
 * Returns the customerId + orderId.
 */
export async function createOrder(
  shopId: string,
  opts: { status?: OrderStatus } = {},
): Promise<{ customerId: string; orderId: string }> {
  orderCounter += 1;
  const customer = await prisma.user.create({
    data: { phone: `+9196000${String(orderCounter).padStart(5, '0')}`, role: UserRole.CUSTOMER },
  });
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      shopId,
      status: opts.status ?? OrderStatus.PLACED,
      paymentMethod: PaymentMethod.COD,
      deliveryMode: DeliveryMode.SELF_DELIVERY,
      originalTotalPaise: 11000,
      platformFeePaise: 1000,
      idempotencyKey: `test-idem-${orderCounter}`,
    },
  });
  return { customerId: customer.id, orderId: order.id };
}

