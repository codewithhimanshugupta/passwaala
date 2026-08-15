/**
 * Money helpers.
 *
 * HARD RULE (schema principle #4): money is ALWAYS integer paise, never floats.
 * ₹10 = 1000 paise. Float rupees eventually corrupt commission/ledger totals
 * and can't be undone. Every amount crossing a boundary is an integer paise
 * value.
 */

/** GST rate applied to everything NearBaz charges the shop (18%). */
export const GST_RATE = 0.18;

/** Number of paise in one rupee. */
export const PAISE_PER_RUPEE = 100;

/**
 * Convert a rupee amount to integer paise.
 * Rounds to the nearest paise to absorb floating-point representation error
 * (e.g. 4.99 * 100 = 498.99999...). Throws on non-finite input.
 */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) {
    throw new Error(`rupeesToPaise: expected a finite number, got ${rupees}`);
  }
  return Math.round(rupees * PAISE_PER_RUPEE);
}

/**
 * Convert integer paise to a rupee number.
 * Throws if given a non-integer paise value (paise must be whole).
 */
export function paiseToRupees(paise: number): number {
  if (!Number.isInteger(paise)) {
    throw new Error(`paiseToRupees: expected an integer paise value, got ${paise}`);
  }
  return paise / PAISE_PER_RUPEE;
}

/**
 * Format integer paise as a human-readable rupee string with the ₹ symbol,
 * always showing two decimal places (e.g. 49900 -> "₹499.00").
 * Handles negative amounts (credits) as "-₹X.XX".
 */
export function formatPaise(paise: number): string {
  if (!Number.isInteger(paise)) {
    throw new Error(`formatPaise: expected an integer paise value, got ${paise}`);
  }
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / PAISE_PER_RUPEE);
  const remainder = abs % PAISE_PER_RUPEE;
  const rupeesStr = rupees.toLocaleString('en-IN');
  const paiseStr = remainder.toString().padStart(2, '0');
  return `${negative ? '-' : ''}₹${rupeesStr}.${paiseStr}`;
}

/** Result of a GST computation — all components in integer paise. */
export interface GstBreakdown {
  /** The base (pre-GST) amount in paise. */
  basePaise: number;
  /** The GST component (18% of base) in paise, rounded to nearest paise. */
  gstPaise: number;
  /** basePaise + gstPaise, the GST-inclusive total in paise. */
  totalPaise: number;
}

/**
 * Compute the 18% GST breakdown for a base amount (integer paise).
 * Used for every LedgerEntry: base + GST stored separately; outstandingDues
 * and the credit-limit check use the GST-inclusive total.
 * GST is rounded to the nearest paise. Throws on non-integer input.
 */
export function computeGst(basePaise: number): GstBreakdown {
  if (!Number.isInteger(basePaise)) {
    throw new Error(`computeGst: expected an integer paise value, got ${basePaise}`);
  }
  const gstPaise = Math.round(basePaise * GST_RATE);
  return {
    basePaise,
    gstPaise,
    totalPaise: basePaise + gstPaise,
  };
}
