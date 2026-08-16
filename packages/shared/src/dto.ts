/**
 * Core shared DTOs (Data Transfer Objects).
 *
 * Plain TypeScript interfaces — NO framework decorators, NO runtime deps. These
 * describe the shapes exchanged between the API and the apps so a model change
 * can't silently leak a new field (explicit-DTO principle from the plan's
 * security section).
 *
 * All money fields are integer paise (schema rule #4). All ids are UUID strings.
 */

import { OrderStatus, PaymentMethod, DeliveryMode, BusinessType, AdCampaignStatus, PrescriptionStatus } from './enums';

/** A single line in a create-order request. */
export interface CreateOrderItem {
  /** UUID of the product being ordered. */
  productId: string;
  /** Quantity requested (>= 1). */
  quantity: number;
}

/**
 * Request body to place an order. A cart maps to exactly ONE shop
 * (single-shop cart rule), so a single shopId covers all items.
 */
export interface CreateOrder {
  /** UUID of the shop the order is placed with. */
  shopId: string;
  /** UUID of the delivery address (required for SELF_DELIVERY; omit for pickup). */
  addressId?: string;
  /** The line items being ordered (all from the same shop). */
  items: CreateOrderItem[];
  /** Chosen payment method (UPI_DIRECT or COD). */
  paymentMethod: PaymentMethod;
  /** Fulfilment mode (SELF_DELIVERY default, or SELF_PICKUP). */
  deliveryMode?: DeliveryMode;
  /**
   * Client-generated idempotency key so a retry / double-tap never creates a
   * duplicate order and never loses one (exactly-once effect).
   */
  idempotencyKey: string;
  /** Optional free-text delivery instructions. */
  notes?: string;
  /** NearBaz Coins to redeem (1 coin = ₹1), discounting the item subtotal. */
  redeemCoins?: number;
  /** Optional offer template ID the customer wants to apply at checkout. */
  offerId?: string;
  /**
   * Optional coupon code the customer wants to apply at checkout. Mutually
   * exclusive with offerId and with any second coupon — a single order carries at
   * most ONE discount source (enforced server-side). Resolves to either a
   * shop-funded or a NearBaz-funded (platform) coupon.
   */
  couponCode?: string;
}

/**
 * Result returned to the customer immediately after an order is durably
 * committed. Mirrors the itemized bill breakdown shown at checkout.
 */
export interface PlaceOrderResult {
  /** UUID of the newly created order. */
  orderId: string;
  /** Current status (PLACED right after placement). */
  status: OrderStatus;
  /** UUID of the shop. */
  shopId: string;
  /** Sum of item line prices, in paise (before fees). */
  subtotalPaise: number;
  /** Per-shop delivery fee applied to this order, in paise. */
  deliveryFeePaise: number;
  /** Flat platform fee line, in paise (₹10). */
  platformFeePaise: number;
  /** Grand total the customer pays the shop, in paise. */
  totalPaise: number;
  /** Payment method chosen. */
  paymentMethod: PaymentMethod;
  /** Fulfillment mode (SELF_DELIVERY for pilot). */
  deliveryMode: DeliveryMode;
  /**
   * For UPI_DIRECT orders: the UPI deep-link (upi://pay?...) targeting the
   * shop's VPA and the confirmed amount. Absent for COD.
   */
  upiDeepLink?: string;
  /** When the order was created (ISO 8601 timestamp). */
  createdAt: string;
}

/**
 * One line of an in-store POS (counter) sale. A line is EITHER a catalog product
 * (productId set — stock is decremented + price is re-validated server-side) OR a
 * free-text item (name + pricePaise, no productId) the shopkeeper types in.
 */
export interface POSSaleItem {
  /** Catalog product UUID (omit for a free-text line). */
  productId?: string;
  /** Item name — required for a free-text line; ignored for a catalog line (the
   *  server snapshots the real product name). */
  name?: string;
  /** Unit price in paise — required for a free-text line; ignored for a catalog
   *  line (the server re-reads the trusted product price). */
  pricePaise?: number;
  /** Quantity (>= 1). */
  qty: number;
}

/**
 * Request body to ring up an in-store POS sale. Shopkeeper-scoped (@ShopId from
 * the JWT — the shopId is never taken from the body). The sale is created
 * directly at DELIVERED, paid CASH, commission-free. The idempotencyKey makes
 * offline replay exactly-once (the same key returns the already-created sale).
 */
export interface POSCreateSale {
  /** The counter sale's line items (catalog and/or free-text). */
  items: POSSaleItem[];
  /** Payment method — CASH for the counter POS. */
  paymentMethod: PaymentMethod;
  /** Cash tendered by the customer, in paise (optional — for change display/audit). */
  cashTenderedPaise?: number;
  /** Optional captured customer phone (walk-in; for a future receipt/loyalty link). */
  customerPhone?: string;
  /** Optional free-text note printed on the receipt. */
  notes?: string;
  /** Client-generated idempotency key so a retry / offline replay never duplicates. */
  idempotencyKey: string;
}

/** One resolved line on a completed POS sale (for the printed receipt). */
export interface POSSaleResultItem {
  name: string;
  pricePaise: number;
  qty: number;
}

/** Result returned after a POS sale is committed — feeds the printed receipt. */
export interface POSSaleResult {
  /** UUID of the created order. */
  orderId: string;
  /** Human-readable receipt/support id (OR + 8 hex). */
  shortId: string | null;
  /** UUID of the shop. */
  shopId: string;
  /** Status (DELIVERED — counter sale is complete on creation). */
  status: OrderStatus;
  /** Resolved line items with trusted names/prices. */
  items: POSSaleResultItem[];
  /** Sum of line prices, in paise. */
  subtotalPaise: number;
  /** Grand total, in paise (== subtotal; no fees on a counter sale). */
  totalPaise: number;
  /** Payment method (CASH). */
  paymentMethod: PaymentMethod;
  /** When the sale was created (ISO 8601 timestamp). */
  createdAt: string;
}

/**
 * Public, customer-facing view of a shop. Contains ONLY safe storefront data —
 * never private operational data (orders, ledger, dues, KYC).
 */
export interface ShopPublic {
  /** UUID of the shop. */
  id: string;
  /** Display name of the shop. */
  name: string;
  /** PRODUCT or SERVICE. */
  businessType: BusinessType;
  /** Shop category slug (kirana, dairy, medical, ...). */
  shopCategory: string;
  /** Required storefront photo URL (anti-fraud signal, publicly shown). */
  storefrontPhotoUrl: string;
  /** Optional branding logo URL. */
  logoUrl?: string;
  /** Optional branding banner URL. */
  bannerUrl?: string;
  /** Whether the shop is currently accepting orders (effective open state). */
  isOpen: boolean;
  /** Denormalized average rating (null / 0 for a new, unrated shop). */
  avgRating: number;
  /** Denormalized count of ratings (0 for a new shop). */
  ratingCount: number;
  /** Minimum order value enforced on the item subtotal, in paise (0 = none). */
  minOrderValuePaise: number;
  /** Per-shop delivery fee, in paise (0 = free). */
  deliveryFeePaise: number;
  /** Subtotal threshold above which delivery is free, in paise (null = never). */
  freeDeliveryAbovePaise?: number | null;
  /** Distance from the customer's chosen address, in metres (when available). */
  distanceMeters?: number;
  /** Optional short promo shown on the customer home card (display-only). */
  offerText?: string | null;
  /** Active structured offer template (if the shop has one selected). */
  activeOffer?: { id: string; title: string; type: string; value: number; minOrderPaise: number } | null;
  /**
   * True when this shop is currently surfaced via an active, opted-in sponsored
   * ad campaign — the customer UI pins it to the top and shows a "Sponsored"
   * badge. Non-opted-in shops are always false (and are never billed).
   */
  isSponsored?: boolean;
  /**
   * UUID of the AdCampaign responsible for a sponsored placement, so the client
   * can attribute impression/click events for CPC billing. Present only when
   * `isSponsored` is true.
   */
  adCampaignId?: string | null;
  /**
   * True when admin has curated this shop as "Premium" — the customer app
   * surfaces it in a dedicated Premium section. Not a paid ad; never billed.
   */
  isPremium?: boolean;
}

/**
 * Public, customer-facing view of a product within a shop's catalog.
 * Prices/stock are scoped to the owning shop.
 */
export interface ProductPublic {
  /** UUID of the product. */
  id: string;
  /** UUID of the shop that owns this product (data-isolation key). */
  shopId: string;
  /** Product display name. */
  name: string;
  /** Selling price in paise. */
  pricePaise: number;
  /** Maximum retail price in paise (for strike-through display); optional. */
  mrpPaise?: number;
  /** Product image URL; optional. */
  imageUrl?: string;
  /** Whether the product is currently available/in stock for ordering. */
  available: boolean;
  /**
   * Whether stock remains. Customers only ever see in/out-of-stock, never exact
   * stock levels (PII minimization).
   */
  inStock: boolean;
  /** Denormalized per-shop order count, used for popularity sort. */
  orderCount: number;
}

/**
 * ProductDetailPublic — the customer-facing product view PLUS the longer
 * `description`, loaded lazily when the customer taps a product (the list view
 * omits it to stay light). Returned by GET /products/:id.
 */
export interface ProductDetailPublic extends ProductPublic {
  /** Longer product detail; null if the shopkeeper didn't set one. */
  description: string | null;
}

/**
 * ProductSearchHit — one product matched by the cross-shop search, carrying the
 * owning shop's summary so the customer can jump straight into that storefront.
 * Ranked by shop distance (nearest first), so the closest shop stocking a
 * matching product surfaces at the top.
 */
export interface ProductSearchHit {
  /** UUID of the product. */
  id: string;
  /** Product display name. */
  name: string;
  /** Selling price in paise. */
  pricePaise: number;
  /** Maximum retail price in paise (for strike-through display); optional. */
  mrpPaise?: number;
  /** Product image URL; optional. */
  imageUrl?: string;
  /** Whether stock remains (never exact levels — PII minimization). */
  inStock: boolean;
  /** UUID of the shop that stocks this product. */
  shopId: string;
  /** Owning shop's display name. */
  shopName: string;
  /** Owning shop's city. */
  shopCity: string;
  /** Owning shop's logo URL; optional. */
  shopLogoUrl?: string;
  /** Whether the owning shop is currently open. */
  shopIsOpen: boolean;
  /** Owning shop's flat delivery fee in paise. */
  deliveryFeePaise: number;
  /** Owning shop's minimum order value in paise. */
  minOrderValuePaise: number;
  /** Straight-line distance from the customer to the shop, in metres. */
  distanceMeters: number;
}

/**
 * ProductSearchResult — one page of cross-shop product-search hits plus a
 * has-more flag (offset pagination; a few results are shown first, then more on
 * scroll).
 */
export interface ProductSearchResult {
  items: ProductSearchHit[];
  hasMore: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sponsored ads (opt-in CPC). Admin prices & creates campaigns; a shop opts in
// by having an ACTIVE campaign. Clicks are CPC-billed once per customer per day
// and settled into the shop's dues ledger at day-end (see plan). Impressions are
// recorded unbilled for analytics.
// ─────────────────────────────────────────────────────────────────────────────

/** Admin request to create a sponsored-ad campaign for a shop. */
export interface CreateAdCampaign {
  /** UUID of the shop being promoted. */
  shopId: string;
  /** Cost charged per unique daily click, in paise (defaults to the city CPC). */
  cpcPaise?: number;
  /** Lifetime budget cap, in paise — campaign auto-EXHAUSTs when reached. */
  totalBudgetPaise: number;
  /** Shop-set daily spend cap in paise (0 = none). Ad auto-stops for the day when hit. */
  dailyBudgetPaise?: number;
  /** City UUIDs the campaign is eligible in (empty = all of the shop's cities). */
  cityIds?: string[];
  /** ISO 8601 start; defaults to now if omitted. */
  startAt?: string;
  /** ISO 8601 end; null/absent = runs until budget exhausted. */
  endAt?: string | null;
}

/** Admin/shop request to change a campaign (partial). */
export interface UpdateAdCampaign {
  status?: AdCampaignStatus;
  cpcPaise?: number;
  totalBudgetPaise?: number;
  dailyBudgetPaise?: number;
  cityIds?: string[];
  endAt?: string | null;
}

/** A single ad campaign as seen by admin (full) or shop (own). */
export interface AdCampaignView {
  id: string;
  shopId: string;
  shopName: string;
  status: AdCampaignStatus;
  cpcPaise: number;
  totalBudgetPaise: number;
  spentPaise: number;
  /** Shop-set daily spend cap in paise (0 = none). */
  dailyBudgetPaise: number;
  /** Today's billed spend so far in paise (against dailyBudgetPaise). */
  spentTodayPaise: number;
  /** True when the ad is currently serveable (active, within budget + daily cap). */
  serving: boolean;
  cityIds: string[];
  startAt: string;
  endAt?: string | null;
  /** Lifetime impression count for this campaign. */
  impressions: number;
  /** Lifetime click count for this campaign. */
  clicks: number;
  /** Click-through rate (clicks / impressions), 0 when no impressions. */
  ctr: number;
  createdAt: string;
  updatedAt: string;
}

/** A time-bucketed data point for the ads analytics charts. */
export interface AdSeriesPoint {
  /** Bucket label (ISO date for daily buckets). */
  bucket: string;
  impressions: number;
  clicks: number;
  spentPaise: number;
}

/** Headline counters shown on the admin ads dashboard tiles. */
export interface AdAnalyticsTotals {
  campaigns: number;
  activeCampaigns: number;
  impressions: number;
  clicks: number;
  ctr: number;
  spentPaise: number;
}

/** Full admin ads analytics payload: totals + per-campaign + time series. */
export interface AdAnalyticsSummary {
  totals: AdAnalyticsTotals;
  campaigns: AdCampaignView[];
  series: AdSeriesPoint[];
}

/** One shop card on the admin ads dashboard (all-shops grid → drill-down). */
export interface AdShopCard {
  shopId: string;
  shopName: string;
  shopCategory: string;
  city: string;
  /** True when the shop currently has at least one ACTIVE campaign (opted in). */
  isPromoted: boolean;
  /** True when the shop is curated into the (non-billed) Premium section. */
  isPremium: boolean;
  campaignCount: number;
  impressions: number;
  clicks: number;
  ctr: number;
  spentPaise: number;
}

/** Per-shop ads drill-down (admin taps a shop card; also the shop's own view). */
export interface AdShopDrilldown {
  shopId: string;
  shopName: string;
  totals: AdAnalyticsTotals;
  campaigns: AdCampaignView[];
  series: AdSeriesPoint[];
  /** Ad-spend dues currently outstanding for this shop, in paise. */
  outstandingAdDuesPaise: number;
}

/** Batch of impression events reported by the customer app on render. */
export interface AdImpressionBatch {
  /** Campaign UUIDs that were shown in the sponsored slot this render. */
  campaignIds: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Medical-store prescription flow. Customer uploads an Rx image to a medical
// shop; the shop builds a free-text itemized bill (→ an Order in QUOTE_PENDING →
// AWAITING_PAYMENT); customer pays online (UPI only, no COD) → normal pipeline.
// ─────────────────────────────────────────────────────────────────────────────

/** Customer request to submit a prescription to a medical shop. */
export interface CreatePrescription {
  /** UUID of the medical (pharmacy) shop the Rx is sent to. */
  shopId: string;
  /** Uploaded prescription image URLs (at least one). */
  imageUrls: string[];
  /** Optional free-text note (symptoms, preferred brand, etc.). */
  note?: string;
  /** Delivery vs pickup — captured at upload (shop triggers the quote later). */
  deliveryMode?: DeliveryMode;
  /** Customer address UUID (required when deliveryMode is a delivery mode). */
  addressId?: string;
}

/** A single free-text line the shop types when quoting a prescription. */
export interface QuoteLineItem {
  /** Medicine / item name as typed by the shop. */
  name: string;
  /** Unit price in paise. */
  pricePaise: number;
  /** Quantity (>= 1). */
  quantity: number;
}

/** Shop request to quote a prescription — builds the order the customer pays. */
export interface QuotePrescription {
  /** Free-text line items making up the bill. */
  items: QuoteLineItem[];
  /** Optional delivery fee override in paise (defaults to the shop's fee). */
  deliveryFeePaise?: number;
  /** Client idempotency key so a double-submit can't create two orders. */
  idempotencyKey: string;
}

/** Shop request to reject a prescription it can't read / fulfil. */
export interface RejectPrescription {
  reason: string;
}

/** Customer- and shop-facing view of a prescription. */
export interface PrescriptionView {
  id: string;
  /** Short human-friendly reference code. */
  shortId?: string | null;
  status: PrescriptionStatus;
  customerId: string;
  shopId: string;
  shopName: string;
  imageUrls: string[];
  note?: string | null;
  /** Set when status is REJECTED. */
  rejectionReason?: string | null;
  /** UUID of the order created when the shop quoted the Rx (once QUOTED). */
  orderId?: string | null;
  createdAt: string;
  updatedAt: string;
}
