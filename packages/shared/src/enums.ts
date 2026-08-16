/**
 * NearBaz shared enums.
 *
 * These enums are the single source of truth shared across the API and apps.
 *
 * CRITICAL RULE (schema principle #5): enums are APPEND-ONLY.
 * You may ADD new values (e.g. RIDER_ASSIGNED, REFUNDED) with no breaking
 * migration, but you must NEVER rename or remove existing values — doing so
 * breaks historical rows and is how deferred features (delivery, services)
 * bolt on cleanly later.
 *
 * Implemented as TS string enums so the persisted/serialized value is a stable
 * human-readable string (not a positional integer that shifts if values are
 * reordered).
 */

/** Every account role on the platform. Deny-by-default RBAC keys off this. */
export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  SHOPKEEPER = 'SHOPKEEPER',
  RIDER = 'RIDER',
  PROVIDER = 'PROVIDER',
  ADMIN = 'ADMIN',
  OWNER = 'OWNER',
}

/**
 * A shop's business type. The MVP builds PRODUCT only; SERVICE is a future
 * expansion but the enum ships from day one (append-only seam).
 */
export enum BusinessType {
  PRODUCT = 'PRODUCT',
  SERVICE = 'SERVICE',
}

/**
 * Shop verification lifecycle. A shop cannot go live / receive orders until
 * APPROVED. DRAFT -> PENDING_REVIEW -> APPROVED | REJECTED, plus SUSPENDED
 * (admin can suspend an approved shop instantly).
 */
export enum VerificationStatus {
  DRAFT = 'DRAFT',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
}

/**
 * Order lifecycle status. Drives the whole order state machine.
 * Happy path: PLACED -> ACCEPTED -> AWAITING_PAYMENT -> PREPARING -> READY ->
 * [RIDER_ASSIGNED ->] OUT_FOR_DELIVERY -> DELIVERED. Plus exception states
 * REJECTED, CANCELLED, REFUND_PENDING. See order-state-machine.ts for allowed
 * transitions.
 */
export enum OrderStatus {
  PLACED = 'PLACED',
  // Medical/prescription flow: the shop is building the itemized bill from an
  // uploaded prescription before the customer can pay. Set on a shop-quoted
  // prescription order until it is quoted → AWAITING_PAYMENT.
  QUOTE_PENDING = 'QUOTE_PENDING',
  ACCEPTED = 'ACCEPTED',
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  PREPARING = 'PREPARING',
  READY = 'READY',
  // A platform rider has claimed a READY order and is heading to the shop to
  // collect it (verified with the shop's pickup OTP) before going out.
  RIDER_ASSIGNED = 'RIDER_ASSIGNED',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  REFUND_PENDING = 'REFUND_PENDING',
  REFUNDED = 'REFUNDED',
}

/**
 * How the customer pays the shop DIRECTLY (NearBaz is never in the money flow).
 * UPI_DIRECT = UPI deep-link / QR to the shop's VPA; COD = cash on delivery.
 */
export enum PaymentMethod {
  UPI_DIRECT = 'UPI_DIRECT',
  COD = 'COD',
  /** Cash tendered at the counter for an in-store POS sale (shopkeeper-created,
   *  marked paid immediately). Never used in the delivery/rider flow. */
  CASH = 'CASH',
}

/**
 * Order fulfillment mode. Pilot is SELF_DELIVERY (shopkeeper delivers);
 * PLATFORM_RIDER is added later when the rider network ships (append-only seam).
 */
export enum DeliveryMode {
  SELF_DELIVERY = 'SELF_DELIVERY',
  SELF_PICKUP = 'SELF_PICKUP',
  PLATFORM_RIDER = 'PLATFORM_RIDER',
}

/** Per-order-item status used for item substitution / partial availability. */
export enum OrderItemStatus {
  FULFILLED = 'FULFILLED',
  UNAVAILABLE = 'UNAVAILABLE',
}

/**
 * Ledger entry type (what NearBaz is owed / crediting). Credits
 * (REFERRAL_CREDIT, REFUND_REVERSAL) are stored as signed-negative amounts.
 */
export enum LedgerEntryType {
  ONBOARDING_FEE = 'ONBOARDING_FEE',
  COMMISSION = 'COMMISSION',
  PLATFORM_FEE = 'PLATFORM_FEE',
  REFERRAL_CREDIT = 'REFERRAL_CREDIT',
  REFUND_REVERSAL = 'REFUND_REVERSAL',
  /** A shopkeeper's dues payment to NearBaz — stored as a signed-negative amount. */
  PAYMENT = 'PAYMENT',
  /** NearBaz holds COD cash owed to the shop — signed-negative credit. */
  COD_REMITTANCE = 'COD_REMITTANCE',
  /** Shop owes the delivery fee it collected (passed to rider) — positive debit, no GST. */
  RIDER_DELIVERY_FEE = 'RIDER_DELIVERY_FEE',
  /** Informational discount line (total 0) — "you gave ₹X discount". */
  DISCOUNT_GIVEN = 'DISCOUNT_GIVEN',
  /** NearBaz pays a shop its negative balance — positive debit toward 0. */
  SHOP_PAYOUT = 'SHOP_PAYOUT',
  /** Shop owes CPC ad spend for sponsored placement — positive debit, billed at day-end (+GST). */
  AD_SPEND = 'AD_SPEND',
}

/** Rider ledger entry type — mirrors LedgerEntryType for the rider side. */
export enum RiderLedgerType {
  DELIVERY_EARNING = 'DELIVERY_EARNING',
  EARNING_PAYOUT = 'EARNING_PAYOUT',
  COD_COLLECTED = 'COD_COLLECTED',
  COD_DEPOSIT = 'COD_DEPOSIT',
}

/** Tax invoice lifecycle. */
export enum TaxInvoiceStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
}

/**
 * Ledger entry lifecycle. ACCRUED (owed) -> INVOICED (on a settlement statement)
 * -> PAID (shop settled). Credit-limit check sums ACCRUED entries.
 */
export enum LedgerEntryStatus {
  ACCRUED = 'ACCRUED',
  INVOICED = 'INVOICED',
  PAID = 'PAID',
}

/** Who cancelled an order/booking (for audit + accountability). */
export enum CancelledBy {
  CUSTOMER = 'CUSTOMER',
  SHOP = 'SHOP',
  PROVIDER = 'PROVIDER',
  RIDER = 'RIDER',
  SYSTEM = 'SYSTEM',
}

/**
 * Referral lifecycle. PENDING (referral made) -> QUALIFIED (referee's 1st order
 * DELIVERED, coins unlocked) -> REDEEMED (coins used at checkout).
 */
export enum ReferralStatus {
  PENDING = 'PENDING',
  QUALIFIED = 'QUALIFIED',
  REDEEMED = 'REDEEMED',
}

/** Referral type: referring a new shop, or referring a new customer. */
export enum ReferralType {
  SHOP = 'SHOP',
  CUSTOMER = 'CUSTOMER',
}

/**
 * Admin onboarding gate (plan → Security: "admins require owner approval").
 * PENDING_OWNER_APPROVAL → ACTIVE. No one self-becomes an admin.
 */
export enum AdminInviteStatus {
  PENDING_OWNER_APPROVAL = 'PENDING_OWNER_APPROVAL',
  ACTIVE = 'ACTIVE',
}

/** Hours after order creation within which a dispute can be raised. */
export const DISPUTE_WINDOW_HOURS = 48;

/** Discount type for city-level offer templates (append-only). */
export enum OfferType {
  PERCENT_OFF   = 'PERCENT_OFF',   // value = percent (1-100)
  FLAT_OFF      = 'FLAT_OFF',      // value = paise amount off subtotal
  FREE_DELIVERY = 'FREE_DELIVERY', // waives delivery fee entirely
}

/**
 * BulkOrder lifecycle status (append-only). Envelope over multiple sub-orders.
 * PLACED → ACCEPTED_ALL → READY_ALL → RIDER_ASSIGNED → PICKING_UP
 * → OUT_FOR_DELIVERY → DELIVERED. CANCELLED ends the run.
 */
export enum BulkOrderStatus {
  PLACED           = 'PLACED',
  ACCEPTED_ALL     = 'ACCEPTED_ALL',
  READY_ALL        = 'READY_ALL',
  RIDER_ASSIGNED   = 'RIDER_ASSIGNED',
  PICKING_UP       = 'PICKING_UP',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED        = 'DELIVERED',
  CANCELLED        = 'CANCELLED',
}

/**
 * Sponsored-ad campaign lifecycle (append-only). Ads are OPT-IN — a shop enables
 * promotion → ACTIVE. Auto-flips EXHAUSTED (budget spent) / EXPIRED (past end);
 * admin/shop can PAUSE. Only ACTIVE campaigns pin a shop top of discovery + bill.
 */
export enum AdCampaignStatus {
  ACTIVE    = 'ACTIVE',
  PAUSED    = 'PAUSED',
  EXHAUSTED = 'EXHAUSTED',
  EXPIRED   = 'EXPIRED',
}

/** Ad interaction event (append-only). CLICK is CPC-billed once per customer per day. */
export enum AdEventType {
  IMPRESSION = 'IMPRESSION',
  CLICK      = 'CLICK',
}

/**
 * Prescription (medical-store-only) lifecycle (append-only). SUBMITTED (customer
 * uploaded Rx) → QUOTED (shop built the itemized bill → an Order) → CONVERTED
 * (customer paid). REJECTED if the shop can't fulfil / read it.
 */
export enum PrescriptionStatus {
  SUBMITTED = 'SUBMITTED',
  QUOTED    = 'QUOTED',
  CONVERTED = 'CONVERTED',
  REJECTED  = 'REJECTED',
}

/**
 * The shop-category slug that unlocks the prescription order flow. Medical shops
 * (pharmacies) can't be shopped from a catalog — customers upload a prescription
 * and the shop builds the bill. Kept as a shared constant so customer/shopkeeper
 * apps and the API all gate on the same slug.
 */
export const MEDICAL_CATEGORY = 'medical';
