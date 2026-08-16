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
  /** NearBaz's collection UPI so the rider can deposit COD dues (null if unset). */
  collectionUpi: { vpa: string; name: string } | null;
  lifetimeEarnedPaise?: number;
  lifetimePaidOutPaise?: number;
  /** The rider's service city (source of the delivery-fee tiers below). */
  serviceCity?: string;
  /** Admin-configured per-km delivery fee tiers for the rider's city. */
  deliveryTiers?: Array<{ maxKm: number; feePaise: number }>;
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
 * /riders/jobs and /riders/deliveries.
 */
export interface RiderJob {
  id: string;
  shortId?: string | null;
  status: string;
  paymentMethod?: string;
  paymentConfirmed?: boolean;
  codUpiClaimedAt?: string | null;
  originalTotalPaise: number;
  adjustedTotalPaise?: number | null;
  deliveryFeePaise: number;
  extraDeliveryDuePaise?: number;
  addedItemsDuePaise?: number;
  offerExpiresAt?: string | null;
  dispatchExhausted?: boolean;
  items: JobItem[];
  shop: JobShop;
  address: JobAddress;
  pickupOtp?: string | null;
  createdAt: string;
  updatedAt?: string;
}

/** A sub-order within a bulk job (one per shop). */
export interface BulkSubOrder {
  id: string;
  shopId: string;
  status: string;
  originalTotalPaise: number;
  riderPickupOtp?: string | null;
  items: JobItem[];
  shop: JobShop;
}

/** A bulk order job — spans multiple shops, single drop. */
export interface BulkRiderJob {
  id: string;
  shortId?: string | null;
  status: string;
  paymentMethod?: string;
  totalPaise: number;
  baseDeliveryFeePaise: number;
  multiShopSurchargePaise: number;
  offerExpiresAt?: string | null;
  dispatchExhausted?: boolean;
  pickupSequenceJson?: string | null;
  pickupOtp?: string | null;
  createdAt: string;
  updatedAt?: string;
  address: JobAddress;
  orders: BulkSubOrder[];
}

