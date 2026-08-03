import type { OrderStatus, VerificationStatus, LedgerEntryType, LedgerEntryStatus, DeliveryMode } from '@passwaala/shared';

/**
 * App-local types describing the shopkeeper API response shapes. The shared
 * api-client types these owner-scoped endpoints as `unknown`, so we narrow them
 * here (mirroring the API's owner-view mappers) for type-safe screens.
 */

/** A single day's open/close window (24h "HH:MM" strings). */
export interface WorkingHoursDay {
  open: string;
  close: string;
}

/** Per-day working hours keyed by lowercase weekday (mon…sun). */
export type WorkingHours = Record<string, WorkingHoursDay>;

/** Owner view of the caller's own shop (GET /shops/me, POST /shops). */
export interface MyShop {
  id: string;
  name: string;
  shopCategory: string;
  verificationStatus: VerificationStatus;
  storefrontPhotoUrl: string;
  isOpen: boolean;
  city?: string;
  addressLine?: string;
  contactPhone?: string;
  upiVpa?: string;
  /** GST identification number (15 chars) — optional tax identity. */
  gstin?: string;
  /** State code (2 digits) — optional tax identity. */
  stateCode?: string;
  /** Registered legal name — optional, may differ from display name. */
  legalName?: string;
  deliveryFeePaise?: number;
  freeDeliveryAbovePaise?: number;
  minOrderValuePaise?: number;
  workingHours?: WorkingHours;
  /** When true, PassWaala riders deliver orders; when false, the shop self-delivers. */
  platformDeliveryEnabled?: boolean;
  selfPickupEnabled?: boolean;
  /** Optional short promo shown on the customer home card (display-only). */
  offerText?: string;
  /** Active structured offer templates enabled by the shopkeeper (multi-select). */
  activeOfferIds?: string[];
  activeOffers?: Array<{ id: string; title: string; type: string; value: number; minOrderPaise: number }> | null;
}

/** Compact shop summary returned by GET /shops/mine (multi-shop picker). */
export interface MyShopSummary {
  id: string;
  name: string;
  verificationStatus: VerificationStatus;
  isOpen: boolean;
  city?: string;
}

/** A product in the shopkeeper's own catalog (GET /products/mine). */
export interface MyProduct {
  id: string;
  shopId: string;
  name: string;
  pricePaise: number;
  mrpPaise: number;
  stock: number;
  imageUrl: string | null;
  description: string | null;
  available: boolean;
  categoryId: string | null;
  weightGrams: number | null;
}

/** A line item on an order in the feed. */
export interface FeedOrderItem {
  id: string;
  nameSnapshot: string;
  pricePaiseSnapshot: number;
  qty: number;
  status: string;
}

/** An order in the shopkeeper's incoming feed (GET /orders/feed). */
export interface FeedOrder {
  id: string;
  shopId: string;
  /** Human-readable support ID (OR + 8 hex), e.g. OR035CD8E5. */
  shortId?: string | null;
  status: OrderStatus;
  paymentMethod: string;
  deliveryMode: DeliveryMode;
  originalTotalPaise: number;
  adjustedTotalPaise: number | null;
  platformFeePaise: number;
  deliveryFeePaise: number;
  createdAt: string;
  items: FeedOrderItem[];
  shopName?: string | null;
  shop?: { name: string } | null;
  /** True once the shop has verified UPI payment (set on payment-received). */
  paymentConfirmed?: boolean;
  /** Set when the customer has claimed "I've paid" and is awaiting the shop's verification. */
  paymentClaimedAt?: string | null;
  /** How many times the customer has claimed payment (repeat attempts). */
  paymentClaimCount?: number;
  /** Set when the rider claims the customer paid this COD order by UPI/QR at the door. */
  codUpiClaimedAt?: string | null;
  /** Rider pickup OTP — read out to the platform rider when RIDER_ASSIGNED. */
  riderPickupOtp?: string | null;
  /** Customer handoff OTP — entered by the shop to confirm the customer received the order. */
  pickupOtp?: string | null;
  /** One-time nudge message sent by the customer to the shop. */
  customerNudge?: string | null;
  customerNudgedAt?: string | null;
  rider?: { name: string | null; phone: string } | null;
}

/** A ledger entry row (GET /ledger). */
export interface LedgerEntry {
  id: string;
  type: LedgerEntryType;
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
  status: LedgerEntryStatus;
  createdAt: string;
  /** The order this charge belongs to (null for onboarding/referral entries). */
  orderId: string | null;
  /** Short uppercased order ref (null for onboarding/referral). */
  orderNumber: string | null;
}

/** The shopkeeper's ledger summary + entries (GET /ledger). */
export interface Ledger {
  outstandingDuesPaise: number;
  creditLimitPaise: number;
  isOpen: boolean;
  /** PassWaala's collection UPI for this shop's city (null if not configured). */
  collectionUpi?: { vpa: string; name: string } | null;
  entries: LedgerEntry[];
  /** Keyset cursor for the next page of entries (null when exhausted). */
  nextCursor?: string | null;
}
