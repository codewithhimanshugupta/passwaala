/**
 * Rider-app view types. The shared client types the rider job/delivery
 * endpoints as `unknown[]` (they return orders in a rider-oriented shape), so we
 * describe the fields this app actually reads here and cast at the call sites.
 */

/** The signed-in account (GET /account/me). */
export interface MyAccount {
  id: string;
  phone: string;
  name: string | null;
  role: string;
  coinBalance: number;
}

/** A single row in the rider's ledger (recent activity, signed amounts). */
export type RiderLedgerType =
  | 'DELIVERY_EARNING'
  | 'EARNING_PAYOUT'
  | 'COD_COLLECTED'
  | 'COD_DEPOSIT';

export interface RiderLedgerEntry {
  id: string;
  type: RiderLedgerType;
  /** Signed: positive for earnings, negative/neutral for payouts & deposits. */
  amountPaise: number;
  note: string | null;
  orderId: string | null;
  createdAt: string;
}

/** The rider's own profile/stats (GET /riders/me). */
export interface RiderMe {
  online: boolean;
  vehicle: string | null;
  earningsPaise: number;
  duesPaise: number;
  creditLimitPaise: number;
  /** PassWaala's collection UPI so the rider can deposit COD dues (null if unset). */
  collectionUpi: { vpa: string; name: string } | null;
  /** Total ever earned across all deliveries (optional — newer API field). */
  lifetimeEarnedPaise?: number;
  /** Total ever paid out to the rider by PassWaala (optional — newer API field). */
  lifetimePaidOutPaise?: number;
  /** Recent rider-ledger rows (up to 20), newest first (optional — newer API field). */
  ledger?: RiderLedgerEntry[];
}

/** A single line item on a job/delivery order. */
export interface JobItem {
  nameSnapshot: string;
  qty: number;
}

/** The shop a job is picked up from. */
export interface JobShop {
  name: string;
  addressLine?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  upiVpa?: string | null;
}

/** The customer drop address for a job. */
export interface JobAddress {
  line: string;
  landmark?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * A rider job / delivery — an order in the rider-oriented shape returned by
 * /riders/jobs and /riders/deliveries. Only the fields the UI reads are typed.
 */
export interface RiderJob {
  id: string;
  /** Human-readable support ID (OR + 8 hex). */
  shortId?: string | null;
  status: string;
  paymentMethod?: string;
  /** True once the shop confirmed a COD-by-UPI payment (gates completion). */
  paymentConfirmed?: boolean;
  /** Set when the rider claimed the customer paid this COD order by UPI/QR. */
  codUpiClaimedAt?: string | null;
  originalTotalPaise: number;
  adjustedTotalPaise?: number | null;
  deliveryFeePaise: number;
  /** When the current dispatch offer to this rider expires (ISO); drives the countdown. */
  offerExpiresAt?: string | null;
  /** True once dispatch opened this order to all riders (open board). */
  dispatchExhausted?: boolean;
  items: JobItem[];
  shop: JobShop;
  address: JobAddress;
  pickupOtp?: string | null;
  createdAt: string;
  updatedAt?: string;
}
