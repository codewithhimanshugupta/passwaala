import type { Prisma } from '@prisma/client';

/**
 * Shared Prisma `select` fragments for order-returning endpoints. Each endpoint
 * ships only the fields its client actually reads (see each app's types.ts),
 * so internal columns (idempotencyKey, commissionRateSnapshot, riderPickupOtp
 * where not needed, item timestamps) never leave the DB or the API.
 */

/** Compact item line for list views: name + qty only. */
const ITEM_NAME_QTY = { select: { nameSnapshot: true, qty: true } } as const;

/** Full item line for detail/feed views (no audit timestamps). */
const ITEM_DETAIL = {
  select: { id: true, productId: true, nameSnapshot: true, pricePaiseSnapshot: true, qty: true, status: true },
} as const;

/**
 * Rider job / delivery shape (GET /riders/jobs, /riders/deliveries) → RiderJob.
 * No pickupOtp (the rider gets the handoff OTP verbally from the customer) and
 * no internal order columns.
 */
export const RIDER_ORDER_SELECT = {
  id: true,
  shortId: true,
  status: true,
  paymentMethod: true,
  paymentConfirmed: true,
  codUpiClaimedAt: true,
  originalTotalPaise: true,
  adjustedTotalPaise: true,
  deliveryFeePaise: true,
  offerExpiresAt: true,
  dispatchExhausted: true,
  createdAt: true,
  updatedAt: true,
  items: ITEM_NAME_QTY,
  shop: { select: { name: true, addressLine: true, city: true, latitude: true, longitude: true, upiVpa: true } },
  address: { select: { line: true, landmark: true, latitude: true, longitude: true } },
} satisfies Prisma.OrderSelect;

/**
 * Shopkeeper feed shape (GET /orders/feed) → FeedOrder. Keeps riderPickupOtp
 * (the shop reads it out to the rider) but drops commission/idempotency/pickupOtp.
 */
export const SHOP_FEED_SELECT = {
  id: true,
  shortId: true,
  shopId: true,
  status: true,
  paymentMethod: true,
  paymentConfirmed: true,
  paymentClaimedAt: true,
  paymentClaimCount: true,
  codUpiClaimedAt: true,
  deliveryMode: true,
  originalTotalPaise: true,
  adjustedTotalPaise: true,
  platformFeePaise: true,
  deliveryFeePaise: true,
  createdAt: true,
  riderPickupOtp: true,
  pickupOtp: true,
  customerNudge: true,
  customerNudgedAt: true,
  customerAcceptedChanges: true,
  bulkOrderId: true,
  items: ITEM_DETAIL,
  rider: { select: { name: true, phone: true } },
  shop: { select: { name: true } },
} satisfies Prisma.OrderSelect;

/**
 * Customer order detail shape (GET /orders/:id) → OrderDetail. Drops
 * riderPickupOtp, commissionRateSnapshot, idempotencyKey, cancelledBy/cancelledAt,
 * riderId, coinsRedeemedPaise.
 */
export const CUSTOMER_DETAIL_SELECT = {
  id: true,
  shortId: true,
  customerId: true,
  shopId: true,
  status: true,
  paymentMethod: true,
  paymentConfirmed: true,
  paymentClaimedAt: true,
  rejectionReason: true,
  cancellationReason: true,
  cancelledBy: true,
  cancelledAt: true,
  refundConfirmedAt: true,
  originalTotalPaise: true,
  adjustedTotalPaise: true,
  platformFeePaise: true,
  deliveryFeePaise: true,
  discountPaise: true,
  coinsRedeemedPaise: true,
  extraDeliveryDuePaise: true,
  addedItemsDuePaise: true,
  deliveryMode: true,
  pickupOtp: true,
  addressId: true,
  createdAt: true,
  updatedAt: true,
  customerNudge: true,
  customerNudgedAt: true,
  customerAcceptedChanges: true,
  items: ITEM_DETAIL,
  shop: {
    select: {
      id: true,
      name: true,
      upiVpa: true,
      contactPhone: true,
      addressLine: true,
      city: true,
      storefrontPhotoUrl: true,
      latitude: true,
      longitude: true,
      shopCategory: true,
      gstin: true,
      kyc: { select: { fssai: true } },
    },
  },
  address: { select: { line: true, landmark: true, latitude: true, longitude: true } },
  rider: {
    select: {
      name: true,
      phone: true,
      riderProfile: { select: { latitude: true, longitude: true, updatedAt: true } },
    },
  },
} satisfies Prisma.OrderSelect;

/** Narrow shape for mutation responses (status transitions). */
export const ORDER_MUTATION_SELECT = {
  id: true,
  status: true,
  paymentConfirmed: true,
} satisfies Prisma.OrderSelect;
