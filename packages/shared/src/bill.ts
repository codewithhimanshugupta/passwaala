import { PLATFORM_FEE_PAISE } from './constants';
import { computeGst } from './money';
import { OfferType } from './enums';

/**
 * Itemized bill breakdown (plan → Cart & Checkout: SIGNATURE bill breakdown).
 * All amounts integer paise (schema rule #4).
 */
export interface BillBreakdown {
  /** Sum of item line prices (unit price × qty), before fees. */
  subtotalPaise: number;
  /** Per-shop delivery fee (0 when free or waived by threshold). */
  deliveryFeePaise: number;
  /** Platform fee the CUSTOMER pays: ₹10 base + 18% GST = ₹11.80 (GST-inclusive). */
  platformFeePaise: number;
  /** The ₹10 base component of the platform fee (before GST). */
  platformFeeBasePaise: number;
  /** The 18% GST on the platform fee. */
  platformFeeGstPaise: number;
  /** Discount applied from an active offer template (0 when none). */
  discountPaise: number;
  /** True when an offer was applied and the minimum order was met. */
  offerApplied: boolean;
  /** Grand total the customer pays the shop. */
  totalPaise: number;
}

/** Inputs for computing a bill from a shop's economics config. */
export interface BillInput {
  /** Item subtotal in paise (sum of unit price × qty). */
  subtotalPaise: number;
  /** The shop's delivery fee in paise (0 = free). */
  deliveryFeePaise: number;
  /** Threshold at/above which delivery is waived (null = never waived). */
  freeDeliveryAbovePaise?: number | null;
  /** Active offer type (from the shop's selected OfferTemplate). */
  offerType?: OfferType | null;
  /** Offer value: percent (1-100) for PERCENT_OFF, paise for FLAT_OFF, 0 for FREE_DELIVERY. */
  offerValue?: number | null;
  /** Minimum item subtotal for the offer to apply (0 = always). */
  offerMinOrderPaise?: number | null;
  /** Cap on a PERCENT_OFF discount (paise); null/undefined = no cap. */
  offerMaxDiscountPaise?: number | null;
  /** Override the platform fee base (paise). Falls back to the shared PLATFORM_FEE_PAISE constant. */
  platformFeeOverridePaise?: number | null;
}

/**
 * Compute the itemized bill: subtotal + delivery fee (auto-waived when the
 * subtotal meets the shop's free-delivery threshold) + the flat ₹10 platform
 * fee + optional offer discount. Pure function — no side effects, all integer paise.
 */
export function computeBill(input: BillInput): BillBreakdown {
  const subtotalPaise = input.subtotalPaise;

  // --- Offer discount ---
  let discountPaise = 0;
  let offerApplied = false;
  const minMet = !input.offerMinOrderPaise || subtotalPaise >= input.offerMinOrderPaise;

  if (input.offerType && minMet) {
    offerApplied = true;
    if (input.offerType === OfferType.PERCENT_OFF && input.offerValue) {
      discountPaise = Math.floor(subtotalPaise * input.offerValue / 100);
      // Cap the percentage discount at a max ₹ amount when configured.
      if (input.offerMaxDiscountPaise != null && input.offerMaxDiscountPaise > 0) {
        discountPaise = Math.min(discountPaise, input.offerMaxDiscountPaise);
      }
    } else if (input.offerType === OfferType.FLAT_OFF && input.offerValue) {
      discountPaise = Math.min(input.offerValue, subtotalPaise);
    }
    // FREE_DELIVERY handled below via effectiveDeliveryFee
  }

  // --- Delivery fee ---
  const isFreeDeliveryOffer = input.offerType === OfferType.FREE_DELIVERY && offerApplied;
  const waived =
    input.freeDeliveryAbovePaise != null &&
    subtotalPaise >= input.freeDeliveryAbovePaise;
  const deliveryFeePaise = (isFreeDeliveryOffer || waived) ? 0 : input.deliveryFeePaise;

  // --- Platform fee ---
  const feeBase = input.platformFeeOverridePaise ?? PLATFORM_FEE_PAISE;
  const feeGst = computeGst(feeBase);
  const platformFeePaise = feeGst.totalPaise;

  const totalPaise = Math.max(0, subtotalPaise - discountPaise) + deliveryFeePaise + platformFeePaise;

  return {
    subtotalPaise,
    deliveryFeePaise,
    platformFeePaise,
    platformFeeBasePaise: feeGst.basePaise,
    platformFeeGstPaise: feeGst.gstPaise,
    discountPaise,
    offerApplied,
    totalPaise,
  };
}
