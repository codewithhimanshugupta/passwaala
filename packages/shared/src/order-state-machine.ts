import { OrderStatus } from './enums';

/**
 * PassWaala order state machine — the single source of truth for which order
 * status transitions are allowed.
 *
 * Happy-path lifecycle (accept-before-pay ordering — see plan):
 *   PLACED -> ACCEPTED -> AWAITING_PAYMENT -> PREPARING -> READY ->
 *   [RIDER_ASSIGNED ->] OUT_FOR_DELIVERY -> DELIVERED
 *
 * RIDER_ASSIGNED only occurs for PLATFORM_RIDER orders (a rider claimed a READY
 * order and must verify the shop's pickup OTP before going out). Self-delivery /
 * self-pickup shops go READY -> OUT_FOR_DELIVERY directly.
 *
 * Because PassWaala is NOT in the money flow, the shop accepts (and can adjust
 * for stock) BEFORE the customer pays. Rejections / out-of-stock adjustments
 * therefore happen before any money changes hands.
 *
 * Exception states:
 *   - REJECTED  : shop declines a just-placed order, or no-response auto-cancel.
 *   - CANCELLED : either side cancels freely before payment (PLACED / ACCEPTED /
 *                 AWAITING_PAYMENT).
 *   - REFUND_PENDING : the rare money-already-paid case (customer paid, then the
 *                 order can't proceed) — the shop refunds the customer directly.
 *
 * ------------------------------------------------------------------------
 * CUSTOMER-FACING COLLAPSING — the 6 internal fulfillment states map to
 * ~4 customer-facing steps in the tracking timeline:
 *
 *   Internal state        -> Customer-facing step
 *   ---------------------    ---------------------
 *   PLACED                -> Placed
 *   ACCEPTED              -> Placed          (still "order placed / confirmed")
 *   AWAITING_PAYMENT      -> Placed          (payment prompt overlays this)
 *   PREPARING             -> Preparing
 *   READY                 -> Preparing       (folded into "preparing")
 *   RIDER_ASSIGNED        -> Out for delivery (rider en route to shop)
 *   OUT_FOR_DELIVERY      -> Out for delivery
 *   DELIVERED             -> Delivered
 *
 * (Exception states REJECTED / CANCELLED / REFUND_PENDING render as their own
 * terminal/attention states, not part of the 4-step happy path.)
 * ------------------------------------------------------------------------
 */

/**
 * Allowed transitions: for each status, the set of statuses it may move to.
 * A status with an empty array is terminal.
 *
 * COD orders skip the payment step: ACCEPTED can move directly to PREPARING.
 * UPI orders go ACCEPTED -> AWAITING_PAYMENT -> PREPARING. Both paths are
 * permitted here; the payment method decides which one an order actually takes.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  // Just placed: shop accepts, rejects, or either side cancels before payment.
  [OrderStatus.PLACED]: [
    OrderStatus.ACCEPTED,
    OrderStatus.REJECTED,
    OrderStatus.CANCELLED,
  ],
  // Accepted: UPI -> AWAITING_PAYMENT; COD -> PREPARING directly. Still
  // cancellable before payment. Shop may still reject (e.g. stock gone).
  [OrderStatus.ACCEPTED]: [
    OrderStatus.AWAITING_PAYMENT,
    OrderStatus.PREPARING,
    OrderStatus.REJECTED,
    OrderStatus.CANCELLED,
  ],
  // Awaiting payment (UPI): customer pays -> PREPARING; cancel is still free
  // (no money moved yet). If a paid order then can't proceed -> REFUND_PENDING.
  [OrderStatus.AWAITING_PAYMENT]: [
    OrderStatus.PREPARING,
    OrderStatus.REJECTED,
    OrderStatus.CANCELLED,
    OrderStatus.REFUND_PENDING,
  ],
  // Preparing (after payment for UPI): advances to ready. A cancel here is a
  // dispute -> REFUND_PENDING (money may already have moved).
  [OrderStatus.PREPARING]: [
    OrderStatus.READY,
    OrderStatus.REFUND_PENDING,
  ],
  // Ready: a platform rider claims it (RIDER_ASSIGNED), or a self-delivery/
  // self-pickup shop takes it out directly. Dispute path to REFUND_PENDING.
  [OrderStatus.READY]: [
    OrderStatus.RIDER_ASSIGNED,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.REFUND_PENDING,
  ],
  // Rider assigned: the rider verifies the shop's pickup OTP to collect the
  // order, moving it out for delivery. Dispute path to REFUND_PENDING.
  [OrderStatus.RIDER_ASSIGNED]: [
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.REFUND_PENDING,
  ],
  // Out for delivery: delivered, or a dispute path to REFUND_PENDING.
  [OrderStatus.OUT_FOR_DELIVERY]: [
    OrderStatus.DELIVERED,
    OrderStatus.REFUND_PENDING,
  ],
  // Terminal states.
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.REJECTED]: [],
  [OrderStatus.CANCELLED]: [],
  // Refund handled off-platform (shop pays customer directly). The customer then
  // confirms receipt → REFUNDED (terminal). Not confirming keeps it here.
  [OrderStatus.REFUND_PENDING]: [OrderStatus.REFUNDED],
  [OrderStatus.REFUNDED]: [],
};

/**
 * Returns true if an order may transition from `from` to `to`.
 * Pure function — no side effects.
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  const allowed = ORDER_TRANSITIONS[from];
  if (!allowed) {
    return false;
  }
  return allowed.includes(to);
}

/**
 * Returns the list of statuses an order may move to from `from`.
 * Returns a fresh array (safe to mutate); empty for terminal states.
 */
export function nextStatuses(from: OrderStatus): OrderStatus[] {
  const allowed = ORDER_TRANSITIONS[from];
  return allowed ? [...allowed] : [];
}

/** True if the given status is terminal (no further transitions allowed). */
export function isTerminalStatus(status: OrderStatus): boolean {
  return nextStatuses(status).length === 0;
}
