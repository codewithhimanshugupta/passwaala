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

import { OrderStatus, PaymentMethod, DeliveryMode, BusinessType } from './enums';

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
