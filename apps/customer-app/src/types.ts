/**
 * Local, app-side types for API responses the shared client returns as
 * `unknown` (cart, orders, addresses, reviews, account). These mirror the live
 * API shapes verified against the dev server. Kept here so screens stay typed
 * without touching the shared package.
 */
import type { DeliveryMode, OrderStatus, PaymentMethod, ShopPublic } from '@passwaala/shared';

/**
 * Public shop view + the newer contact fields the API now returns on
 * api.shop()/api.nearbyShops() but which aren't declared on the shared
 * ShopPublic type yet. Declared here (optional) so screens can read them.
 */
export interface ShopContactFields {
  city?: string | null;
  addressLine?: string | null;
  contactPhone?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  platformDeliveryEnabled?: boolean;
  selfPickupEnabled?: boolean;
  logoUrl?: string | null;
  /** True when a delivery option is available right now (rider nearby or self-delivery). */
  deliveryAvailable?: boolean;
  /** True when no delivery/rider option is available for this shop right now. */
  deliveryUnavailable?: boolean;
  /** Distance fee-tiers for platform-rider delivery (from the shop's city). Lets
   *  the cart compute the exact delivery fee locally with no server round-trip. */
  deliveryTiers?: Array<{ maxKm: number; feePaise: number }> | null;
  riderCheckRadiusMeters?: number | null;
  /** Admin-set serviceable delivery radius (metres). A drop outside this circle
   *  is out-of-range: block placement + show "change address". */
  deliveryRadiusMeters?: number | null;
  /** Full offer/coupon list for this shop (city offers + shop coupons), preloaded
   *  so the cart shows + applies offers instantly. */
  availableOffers?: Array<{ id: string; title: string; type: string; value: number; minOrderPaise: number }>;
}
export type ShopView = ShopPublic & ShopContactFields;

/** A single line item in the server cart. */
export interface CartItem {
  productId: string;
  name: string;
  unitPricePaise: number;
  qty: number;
  lineTotalPaise: number;
  available: boolean;
}

export interface CartBill {
  subtotalPaise: number;
  deliveryFeePaise: number;
  platformFeePaise: number;
  platformFeeBasePaise?: number;
  platformFeeGstPaise?: number;
  discountPaise: number;
  offerApplied: boolean;
  totalPaise: number;
}

/**
 * Referral / PassWaala Coins profile (GET /referrals/me via api.referralMe()).
 * Kept local so the ProfileScreen stays typed without touching shared packages.
 */
export interface ReferralEntry {
  id: string;
  type: string;
  status: string;
  coinReward: number;
  createdAt: string;
}

export interface ReferralInfo {
  referralCode: string | null;
  coinBalance: number;
  referrals: ReferralEntry[];
}

/** GET /cart and cart-mutation responses. */
export interface Cart {
  empty: boolean;
  shop?: { id: string; name: string; isOpen: boolean; selfPickupEnabled?: boolean };
  items: CartItem[];
  bill?: CartBill;
  activeOffer?: { id: string; title: string; type: string; value: number; minOrderPaise: number } | null;
  availableOffers?: Array<{ id: string; title: string; type: string; value: number; minOrderPaise: number }>;
  minOrderValuePaise?: number;
  meetsMinOrder?: boolean;
  amountToMinOrderPaise?: number;
  /** True when at least one rider is online near the shop (platform delivery). */
  riderAvailable?: boolean;
}

export interface Address {
  id: string;
  userId: string;
  line: string;
  landmark?: string | null;
  latitude: string;
  longitude: string;
  label: string;
  createdAt: string;
}

export interface OrderItemDetail {
  id: string;
  productId: string;
  nameSnapshot: string;
  pricePaiseSnapshot: number;
  qty: number;
  status: string;
}

/** GET /orders/:id */
export interface OrderDetail {
  id: string;
  /** Human-readable support ID (OR + 8 hex). */
  shortId?: string | null;
  customerId: string;
  shopId: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentConfirmed: boolean;
  /** Set when the customer has claimed payment ("I've paid") and is awaiting shop verification. */
  paymentClaimedAt?: string | null;
  rejectionReason?: string | null;
  cancellationReason?: string | null;
  /** Who cancelled the order (audit) — CUSTOMER | SHOP | RIDER | SYSTEM. */
  cancelledBy?: string | null;
  cancelledAt?: string | null;
  /** Set when the customer confirmed they received their off-platform refund. */
  refundConfirmedAt?: string | null;
  originalTotalPaise: number;
  adjustedTotalPaise?: number | null;
  platformFeePaise: number;
  deliveryFeePaise: number;
  discountPaise?: number;
  coinsRedeemedPaise?: number;
  extraDeliveryDuePaise?: number;
  addedItemsDuePaise?: number;
  deliveryMode: DeliveryMode;
  /** 4-digit handoff OTP the customer shows the shop to mark the order DELIVERED. */
  pickupOtp?: string | null;
  addressId?: string | null;
  createdAt: string;
  updatedAt: string;
  /** One-time nudge the customer sent to the shop. */
  customerNudge?: string | null;
  customerNudgedAt?: string | null;
  customerAcceptedChanges?: boolean;
  items: OrderItemDetail[];
  shop: {
    id: string;
    name: string;
    upiVpa?: string | null;
    contactPhone?: string | null;
    addressLine?: string | null;
    city?: string | null;
    storefrontPhotoUrl?: string | null;
    latitude?: number | string | null;
    longitude?: number | string | null;
    shopCategory?: string | null;
    gstin?: string | null;
    kyc?: { fssai?: string | null } | null;
  };
  /** Drop address (delivery orders) — line text + coords for map + ETA. */
  address?: {
    line?: string | null;
    landmark?: string | null;
    latitude?: number | string | null;
    longitude?: number | string | null;
  } | null;
  /** The assigned platform rider (PLATFORM_RIDER orders, once claimed). */
  rider?: {
    name: string | null;
    phone: string;
    riderProfile?: { latitude?: number | string | null; longitude?: number | string | null } | null;
  } | null;
}

/** GET /orders/history entries. */
export interface OrderHistoryItem {
  orderId: string;
  /** Human-readable support ID (OR + 8 hex). */
  shortId?: string | null;
  shop: {
    id: string;
    name: string;
    addressLine?: string | null;
    city?: string | null;
    storefrontPhotoUrl?: string | null;
    isOpen?: boolean;
  };
  status: OrderStatus;
  deliveryMode: DeliveryMode;
  itemCount: number;
  items: { nameSnapshot: string; qty: number }[];
  totalPaise: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
  review?: { rating: number; comment?: string | null } | null;
}

// ─── Bulk orders ─────────────────────────────────────────────────────────────

/** One sub-order summary inside a BulkOrderSummary (history list). */
export interface BulkSubOrderSummary {
  id: string;
  shopId: string;
  shop: { name: string };
}

/** GET /bulk-orders history entry. */
export interface BulkOrderSummary {
  id: string;
  shortId: string;
  status: string;
  totalPaise: number;
  createdAt: string;
  orders: BulkSubOrderSummary[];
}

/** One line item inside a BulkSubOrder detail. */
export interface BulkSubOrderItem {
  nameSnapshot: string;
  pricePaiseSnapshot: number;
  qty: number;
}

/** One sub-order inside a BulkOrderDetail (per-shop). */
export interface BulkSubOrder {
  id: string;
  shortId: string;
  shopId: string;
  status: string;
  originalTotalPaise: number;
  platformFeePaise: number;
  discountPaise: number;
  items: BulkSubOrderItem[];
  shop: {
    id: string;
    name: string;
    addressLine?: string | null;
    latitude?: number | string | null;
    longitude?: number | string | null;
  };
}

/** GET /bulk-orders/:id detail response. */
export interface BulkOrderDetail {
  id: string;
  shortId: string;
  status: string;
  paymentMethod: string;
  totalPaise: number;
  baseDeliveryFeePaise: number;
  multiShopSurchargePaise: number;
  platformFeePaise: number;
  pickupOtp?: string | null;
  createdAt: string;
  updatedAt: string;
  address: {
    line?: string | null;
    landmark?: string | null;
    latitude?: number | string | null;
    longitude?: number | string | null;
  };
  orders: BulkSubOrder[];
}

export interface Review {
  id: string;
  rating: number;
  comment?: string | null;
  createdAt: string;
  /** Display name of the reviewer (never their phone). */
  reviewerName?: string | null;
  /** ISO date the reviewer joined PassWaala; rendered as "Member since Mon YYYY". */
  memberSince?: string | null;
}

export interface Account {
  id: string;
  phone: string;
  name?: string | null;
  role: string;
  coinBalance: number;
}
