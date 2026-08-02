/**
 * PassWaala platform constants (Phase 0 defaults).
 *
 * All money values are integer paise (schema rule #4). Rates are unitless
 * decimals. These are the plan's defaults; per-shop overrides (commissionRate,
 * creditLimit, etc.) live on the Shop row and take precedence at runtime.
 */

import { rupeesToPaise } from './money';

/** Default per-shop commission on a delivered PRODUCT order (2%). */
export const DEFAULT_COMMISSION_RATE = 0.02;

/** Commission rate for SERVICE providers (5% — larger tickets, no product margin). */
export const SERVICE_COMMISSION_RATE = 0.05;

/** One-time onboarding fee for a new PRODUCT shop (₹499). */
export const PRODUCT_ONBOARDING_FEE_PAISE = rupeesToPaise(499);

/** One-time onboarding fee for a new SERVICE provider (₹99 — lead-only). */
export const SERVICE_ONBOARDING_FEE_PAISE = rupeesToPaise(99);

/** Flat platform fee added as a line item to every order (₹10). */
export const PLATFORM_FEE_PAISE = rupeesToPaise(10);

/**
 * Default per-shop credit limit (₹500). When outstandingDues (GST-inclusive)
 * reaches this, the shop is auto-paused until it pays down dues.
 */
export const DEFAULT_CREDIT_LIMIT_PAISE = rupeesToPaise(500);

/** PassWaala Coins granted for referring a new shop that completes its 1st order (₹100-off voucher). */
export const REFERRAL_SHOP_COINS = 100;

/** PassWaala Coins granted to referrer AND referee after the referee's 1st order (₹25-off voucher each). */
export const REFERRAL_CUSTOMER_COINS = 25;

/**
 * PLATFORM_RIDER delivery fee tiers by shop→customer great-circle distance.
 * Ordered ascending by `maxMeters`; the first band whose `maxMeters` the
 * distance does not exceed applies. The final band (Infinity) is the catch-all
 * for long-haul deliveries. Self-delivery uses the shop's own flat fee instead;
 * these apply ONLY to platform-rider orders (the rider's cost scales with km).
 */
export const PLATFORM_DELIVERY_TIERS: ReadonlyArray<{ maxMeters: number; feePaise: number }> = [
  { maxMeters: 2000, feePaise: rupeesToPaise(20) },
  { maxMeters: 5000, feePaise: rupeesToPaise(35) },
  { maxMeters: 10000, feePaise: rupeesToPaise(50) },
  { maxMeters: Infinity, feePaise: rupeesToPaise(70) },
];

/**
 * Maximum shop→customer great-circle distance (metres) a delivery order may
 * cover. A drop point farther than this — typically a different city — is
 * out of the shop's serviceable area and the order is rejected on both the
 * client and the server. 15 km comfortably covers a pilot city + its outskirts
 * while excluding neighbouring towns.
 */
export const MAX_DELIVERY_RADIUS_METERS = 15000;


