/**
 * UPI direct-payment helpers (plan → Payments: direct customer→shop, no
 * gateway). NearBaz only builds the deep-link; money flows straight to the
 * shop's VPA. Amount is passed in integer paise and rendered as rupees.
 */

import { paiseToRupees } from './money';

/**
 * Build a UPI intent deep-link (upi://pay?...) targeting a shop's VPA for a
 * given amount (paise). Opens the customer's UPI app pre-filled.
 *
 * @param vpa   the shop's UPI VPA (e.g. "shop@upi")
 * @param payeeName  the shop's display name (shown in the UPI app)
 * @param amountPaise  the confirmed amount in integer paise
 * @param note  optional transaction note (e.g. order id)
 */
export function buildUpiDeepLink(
  vpa: string,
  _payeeName: string,
  amountPaise: number,
  note?: string,
): string {
  const params = new URLSearchParams({
    pa: vpa,
    am: paiseToRupees(amountPaise).toFixed(2),
    cu: 'INR',
  });
  if (note) {
    params.set('tn', note);
  }
  // URLSearchParams encodes '@' as '%40' but UPI apps require the literal '@'
  // in the pa (payee address) field — decode it back.
  // pn (payee name) is intentionally omitted — UPI apps resolve it from the VPA
  // registry, and a mismatched pn causes "Verification Failed" on some apps.
  return `upi://pay?${params.toString().replace('%40', '@')}`;
}
