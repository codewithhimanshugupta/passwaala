import { OrderStatus, VerificationStatus } from '@nearbaz/shared';
import type { BadgeTone } from './ui';
import type { Strings } from './i18n/strings';

/** Human labels + badge tones for a shop's verification status. */
export function verificationMeta(status: VerificationStatus, t: Strings): { label: string; tone: BadgeTone } {
  const v = t.status.verification;
  switch (status) {
    case VerificationStatus.APPROVED:
      return { label: v.approved, tone: 'success' };
    case VerificationStatus.PENDING_REVIEW:
      return { label: v.pendingReview, tone: 'warning' };
    case VerificationStatus.SUSPENDED:
      return { label: v.suspended, tone: 'danger' };
    case VerificationStatus.REJECTED:
      return { label: v.rejected, tone: 'danger' };
    case VerificationStatus.DRAFT:
    default:
      return { label: v.draft, tone: 'neutral' };
  }
}

/** Human labels + badge tones for an order status. */
export function orderStatusMeta(status: OrderStatus, t: Strings): { label: string; tone: BadgeTone } {
  const o = t.status.order;
  switch (status) {
    case OrderStatus.PLACED:
      return { label: o.placed, tone: 'info' };
    case OrderStatus.ACCEPTED:
      return { label: o.accepted, tone: 'accent' };
    case OrderStatus.AWAITING_PAYMENT:
      return { label: o.awaitingPayment, tone: 'warning' };
    case OrderStatus.PREPARING:
      return { label: o.preparing, tone: 'accent' };
    case OrderStatus.READY:
      return { label: o.ready, tone: 'success' };
    case OrderStatus.RIDER_ASSIGNED:
      return { label: o.riderAssigned, tone: 'accent' };
    case OrderStatus.OUT_FOR_DELIVERY:
      return { label: o.outForDelivery, tone: 'accent' };
    case OrderStatus.DELIVERED:
      return { label: o.delivered, tone: 'success' };
    case OrderStatus.REJECTED:
      return { label: o.rejected, tone: 'danger' };
    case OrderStatus.CANCELLED:
      return { label: o.cancelled, tone: 'neutral' };
    case OrderStatus.REFUND_PENDING:
      return { label: o.refundPending, tone: 'danger' };
    case OrderStatus.REFUNDED:
      return { label: o.refunded, tone: 'success' };
    default:
      return { label: String(status), tone: 'neutral' };
  }
}

/** A friendly action label for a target order status (for buttons). */
export function actionLabel(status: OrderStatus, t: Strings): string {
  const a = t.status.action;
  switch (status) {
    case OrderStatus.ACCEPTED:
      return a.accept;
    case OrderStatus.REJECTED:
      return a.reject;
    case OrderStatus.AWAITING_PAYMENT:
      return a.requestPayment;
    case OrderStatus.PREPARING:
      return a.startPreparing;
    case OrderStatus.READY:
      return a.markReady;
    case OrderStatus.OUT_FOR_DELIVERY:
      return a.outForDelivery;
    case OrderStatus.DELIVERED:
      return a.markDelivered;
    case OrderStatus.CANCELLED:
      return a.cancel;
    case OrderStatus.REFUND_PENDING:
      return a.refund;
    default:
      return String(status);
  }
}
