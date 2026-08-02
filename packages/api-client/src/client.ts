import type {
  CreateOrder,
  PlaceOrderResult,
  ProductPublic,
  ShopPublic,
} from '@passwaala/shared';

/** A discovered nearby shop (public view + distance). */
export interface NearbyShop extends ShopPublic {
  distanceMeters: number;
}

/**
 * A page of keyset-paginated results: the rows plus the cursor to fetch the
 * next page (null when there are no more). Mirrors the API's Paginated<T>.
 */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/** Query params accepted by every keyset-paginated list endpoint. */
export interface PageParams {
  limit?: number;
  cursor?: string;
}

/** Build a `?limit=&cursor=` query string (empty string when no params set). */
function pageQuery(opts: PageParams): string {
  const q = new URLSearchParams();
  if (opts.limit != null) q.set('limit', String(opts.limit));
  if (opts.cursor) q.set('cursor', opts.cursor);
  const qs = q.toString();
  return qs ? `?${qs}` : '';
}

/** Options for constructing the client. */
export interface ApiClientOptions {
  /** API base URL, e.g. http://localhost:3000 (no trailing slash). */
  baseUrl: string;
  /** Optional initial bearer token. */
  token?: string;
  /** Optional fetch impl (defaults to global fetch — RN + web both have it). */
  fetchImpl?: typeof fetch;
  /** Called whenever the token changes (set/clear) so the app can persist it. */
  onTokenChange?: (token?: string) => void;
  /**
   * Called when any request gets a 401 (expired/invalid token). The client
   * clears the token first, then invokes this so the app can route to login.
   */
  onUnauthorized?: () => void;
}

/** Error thrown on a non-2xx API response. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * AuthExpiredError — thrown on a 401 so callers can distinguish an expired
 * session from other failures (the client has already cleared the token and
 * fired onUnauthorized by the time this throws).
 */
export class AuthExpiredError extends ApiError {
  constructor(message = 'Your session has expired. Please log in again.') {
    super(401, message);
    this.name = 'AuthExpiredError';
  }
}

/**
 * PasswaalaApiClient — a single typed client for the PassWaala API, shared by the
 * customer + shopkeeper Expo apps (and any web/admin surface). Pure fetch, no
 * framework deps, so it runs on React Native, RN Web, and Node alike.
 *
 * The auth token is held in memory; the apps persist it (SecureStore /
 * localStorage) and call setToken() on startup.
 */
export class PasswaalaApiClient {
  private baseUrl: string;
  private token?: string;
  private fetchImpl: typeof fetch;
  private onTokenChange?: (token?: string) => void;
  private onUnauthorized?: () => void;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.token = opts.token;
    this.onTokenChange = opts.onTokenChange;
    this.onUnauthorized = opts.onUnauthorized;
    // Bind to the global object: a bare `fetch` reference called as a method
    // (this.fetchImpl(...)) detaches it from window and browsers throw
    // "Illegal invocation". Binding preserves the correct receiver.
    const f = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
    this.fetchImpl = f.bind(globalThis);
  }

  /** Set (or clear) the bearer token; notifies onTokenChange so apps persist it. */
  setToken(token?: string): void {
    this.token = token;
    this.onTokenChange?.(token);
  }

  /** The current bearer token, if any. */
  getToken(): string | undefined {
    return this.token;
  }

  // ---- Auth ----
  /** Sign up with phone + name + password. Returns a token + a one-time backup OTP. */
  signup(phone: string, name: string, password: string, appType?: string): Promise<{ accessToken: string; role: string; loginOtp: string }> {
    return this.post('/auth/signup', { phone, name, password, ...(appType && { appType }) });
  }
  /** Log in with phone + credential (password OR the fixed backup OTP). */
  login(phone: string, credential: string, appType?: string): Promise<{ accessToken: string; role: string }> {
    return this.post('/auth/login', { phone, credential, ...(appType && { appType }) });
  }
  requestOtp(phone: string, appType?: string): Promise<{ sent: true }> {
    return this.post('/auth/request-otp', { phone, ...(appType && { appType }) });
  }
  verifyOtp(phone: string, code: string, appType?: string): Promise<{ accessToken: string; role: string }> {
    return this.post('/auth/verify-otp', { phone, code, ...(appType && { appType }) });
  }

  // ---- Discovery ----
  nearbyShops(params: {
    lat: number;
    lng: number;
    radiusMeters?: number;
    sort?: 'distance' | 'rating';
    openNow?: boolean;
    category?: string;
    minRating?: number;
  }): Promise<NearbyShop[]> {
    const q = new URLSearchParams();
    q.set('lat', String(params.lat));
    q.set('lng', String(params.lng));
    if (params.radiusMeters) q.set('radiusMeters', String(params.radiusMeters));
    if (params.sort) q.set('sort', params.sort);
    if (params.openNow) q.set('openNow', 'true');
    if (params.category) q.set('category', params.category);
    if (params.minRating != null) q.set('minRating', String(params.minRating));
    return this.get(`/shops/nearby?${q.toString()}`);
  }
  shop(id: string): Promise<ShopPublic> {
    return this.get(`/shops/${id}`);
  }
  shopProducts(shopId: string): Promise<ProductPublic[]> {
    return this.get(`/products?shopId=${shopId}`);
  }
  /** Search/filter a shop's catalog by name and/or category. */
  searchProducts(shopId: string, opts: { q?: string; categoryId?: string } = {}): Promise<ProductPublic[]> {
    const p = new URLSearchParams({ shopId });
    if (opts.q) p.set('q', opts.q);
    if (opts.categoryId) p.set('categoryId', opts.categoryId);
    return this.get(`/products?${p.toString()}`);
  }
  /** Public: a shop's categories (for the drill-down). */
  shopCategories(shopId: string): Promise<Array<{ id: string; name: string }>> {
    return this.get(`/categories?shopId=${shopId}`);
  }

  // ---- Referrals / PassWaala Coins ----
  referralMe(): Promise<{
    referralCode: string | null;
    coinBalance: number;
    referrals: Array<{ id: string; type: string; status: string; coinReward: number; createdAt: string }>;
  }> {
    return this.get('/referrals/me');
  }
  applyReferral(code: string): Promise<{ applied: true }> {
    return this.post('/referrals/apply', { code });
  }

  // ---- Cart ----
  /**
   * The current cart + bill. Pass `deliveryMode`/`addressId` to preview the
   * exact delivery fee for that fulfilment choice (distance-tiered for a
   * platform-rider delivery); omit them for the default flat-fee preview.
   */
  cart(opts: { deliveryMode?: string; addressId?: string; selectedOfferId?: string } = {}): Promise<unknown> {
    const q = new URLSearchParams();
    if (opts.deliveryMode) q.set('deliveryMode', opts.deliveryMode);
    if (opts.addressId) q.set('addressId', opts.addressId);
    if (opts.selectedOfferId) q.set('selectedOfferId', opts.selectedOfferId);
    const qs = q.toString();
    return this.get(`/cart${qs ? `?${qs}` : ''}`);
  }
  addToCart(productId: string, qty: number): Promise<unknown> {
    return this.post('/cart/items', { productId, qty });
  }
  setCartQty(productId: string, qty: number): Promise<unknown> {
    return this.patch(`/cart/items/${productId}`, { qty });
  }
  clearCart(): Promise<unknown> {
    return this.delete('/cart');
  }

  // ---- Addresses ----
  addresses(): Promise<unknown[]> {
    return this.get('/addresses');
  }
  createAddress(body: {
    line: string;
    landmark?: string;
    latitude: number;
    longitude: number;
    label: string;
  }): Promise<{ id: string }> {
    return this.post('/addresses', body);
  }
  updateAddress(
    id: string,
    body: Partial<{ line: string; landmark?: string; latitude: number; longitude: number; label: string }>,
  ): Promise<unknown> {
    return this.patch(`/addresses/${id}`, body);
  }
  deleteAddress(id: string): Promise<unknown> {
    return this.delete(`/addresses/${id}`);
  }

  // ---- Reviews ----
  shopReviews(shopId: string): Promise<unknown[]> {
    return this.get(`/reviews/shop/${shopId}`);
  }
  createReview(body: { orderId: string; rating: number; comment?: string }): Promise<unknown> {
    return this.post('/reviews', body);
  }

  // ---- Admin / owner ----
  adminDashboard(period?: 'Today' | 'Weekly' | 'Monthly' | 'Yearly'): Promise<{
    shops: number;
    activeShops: number;
    totalOrders: number;
    deliveredOrders: number;
    gmvPaise: number;
    passwalaRevenuePaise: number;
    refundPendingCount: number;
    statusCounts: {
      pending: number;
      processing: number;
      completed: number;
      cancelled: number;
      refundPending: number;
      refunded: number;
    };
  }> {
    const qs = period ? `?${new URLSearchParams({ period }).toString()}` : '';
    return this.get(`/admin/dashboard${qs}`);
  }
  adminPendingShops(): Promise<unknown[]> {
    return this.get('/admin/shops/pending');
  }
  /** Disputed orders (CANCELLED / REFUND_PENDING) with reasons, keyset paginated. */
  adminDisputes(opts: PageParams = {}): Promise<Paginated<{
    orderId: string;
    orderNumber: string;
    status: string;
    cancelledBy: string | null;
    reason: string | null;
    paymentMethod: string;
    totalPaise: number;
    shop: { id: string; name: string; city: string | null };
    createdAt: string;
    updatedAt: string;
  }>> {
    return this.get(`/admin/orders/disputes${pageQuery(opts)}`);
  }
  /** All shops (optionally by city) with config — for the admin console. */
  adminAllShops(city?: string): Promise<Array<{
    id: string; name: string; shopCategory: string; city: string;
    verificationStatus: string; isOpen: boolean; commissionRate: number;
    outstandingDuesPaise: number; creditLimitPaise: number; contactPhone: string | null;
  }>> {
    return this.get(`/admin/shops${city ? `?city=${encodeURIComponent(city)}` : ''}`);
  }
  adminShopKyc(shopId: string): Promise<unknown> {
    return this.get(`/admin/shops/${shopId}/kyc`);
  }
  adminApproveShop(shopId: string): Promise<unknown> {
    return this.post(`/admin/shops/${shopId}/approve`, {});
  }
  adminRejectShop(shopId: string, reason: string): Promise<unknown> {
    return this.post(`/admin/shops/${shopId}/reject`, { reason });
  }
  adminSuspendShop(shopId: string): Promise<unknown> {
    return this.post(`/admin/shops/${shopId}/suspend`, {});
  }
  /** Admin/owner: reactivate a suspended shop → APPROVED (starts closed). */
  adminReactivateShop(shopId: string): Promise<unknown> {
    return this.post(`/admin/shops/${shopId}/reactivate`, {});
  }
  /** Admin/owner: set a shop's commission rate (decimal, 0.02 = 2%). */
  adminSetCommission(shopId: string, rate: number): Promise<{ commissionRate: number }> {
    return this.post(`/admin/shops/${shopId}/commission`, { rate });
  }
  /** Admin/owner: all riders with earnings + COD dues + active orders. */
  adminListRiders(city?: string): Promise<Array<{
    userId: string; name: string | null; phone: string | null; vehicle: string | null;
    online: boolean; earningsPaise: number; duesPaise: number; creditLimitPaise: number;
    totalDeliveries: number; todayDeliveries: number; cities: string[]; loginOtp: string | null;
    activeOrders: Array<{
      orderId: string; orderRef: string; status: string;
      shopName: string | null; totalPaise: number; paymentMethod: string;
    }>;
  }>> {
    const qs = city?.trim() ? `?${new URLSearchParams({ city: city.trim() }).toString()}` : '';
    return this.get(`/admin/riders${qs}`);
  }
  /** Admin/owner: record a rider's COD cash deposit → clears their dues. */
  adminRecordRiderPayment(userId: string): Promise<{ settled: true; clearedPaise: number }> {
    return this.post(`/admin/riders/${userId}/record-payment`, {});
  }
  /** Admin/owner: pay a rider their accrued delivery earnings. */
  adminPayRiderEarnings(userId: string, amountPaise: number): Promise<{ paid: true; newEarningsPaise: number }> {
    return this.post(`/admin/riders/${userId}/pay-earnings`, { amountPaise });
  }
  /** Admin/owner: pay a shop its negative balance (COD remittance owed). */
  adminPayShopPayable(shopId: string, amountPaise: number): Promise<{ paid: true; newDuesPaise: number }> {
    return this.post(`/admin/shops/${shopId}/pay-payable`, { amountPaise });
  }
  // ---- GST (admin/owner) ----
  gstConfig(): Promise<unknown> {
    return this.get('/admin/gst/config');
  }
  gstUpsertConfig(body: { legalName: string; gstin: string; stateCode: string; address?: string; invoicePrefix?: string }): Promise<unknown> {
    return this.patch('/admin/gst/config', body);
  }
  gstGenerateInvoices(periodStart: string, periodEnd: string): Promise<unknown[]> {
    return this.post('/admin/gst/invoices/generate', { periodStart, periodEnd });
  }
  gstListInvoices(status?: string): Promise<unknown[]> {
    return this.get(`/admin/gst/invoices${status ? `?status=${status}` : ''}`) as Promise<unknown[]>;
  }
  gstGstr1(periodStart: string, periodEnd: string): Promise<unknown> {
    return this.get(`/admin/gst/gstr1?periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`);
  }
  gstSummary(periodStart: string, periodEnd: string): Promise<unknown> {
    return this.get(`/admin/gst/summary?periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`);
  }
  /** Admin/owner: list all pending payment claims (shops + riders). */
  adminListPaymentClaims(): Promise<unknown[]> {
    return this.get('/admin/payment-claims');
  }
  /** Admin/owner: all orders across the platform (live + completed). */
  adminListOrders(opts?: { limit?: number; cursor?: string; status?: string }): Promise<unknown> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.cursor) params.set('cursor', opts.cursor);
    if (opts?.status) params.set('status', opts.status);
    const qs = params.toString();
    return this.get(`/admin/orders${qs ? `?${qs}` : ''}`);
  }
  /** Admin/owner: approve a payment claim — decrements payer balance by claimed amount. */
  adminApprovePaymentClaim(id: string): Promise<{ approved: true }> {
    return this.post(`/admin/payment-claims/${id}/approve`, {});
  }

  // ---- Disputes / help chat ----
  /** Customer: send a one-time nudge message to the shop on an active order. */
  sendOrderNudge(orderId: string, message: string): Promise<unknown> {
    return this.post(`/orders/${orderId}/nudge`, { message });
  }
  /** Customer: accept shop's item changes (removed items). */
  acceptOrderChanges(orderId: string): Promise<unknown> {
    return this.post(`/orders/${orderId}/accept-changes`, {});
  }
  /** Customer: confirm an off-platform refund was received → REFUNDED. */
  confirmRefundReceived(orderId: string): Promise<unknown> {
    return this.post(`/orders/${orderId}/refund-received`, {});
  }
  raiseDispute(orderId: string, reason: string): Promise<unknown> {
    return this.post('/disputes', { orderId, reason });
  }
  myDispute(orderId: string): Promise<unknown> {
    return this.get(`/disputes/my/${orderId}`);
  }
  disputeThread(disputeId: string): Promise<unknown> {
    return this.get(`/disputes/${disputeId}/messages`);
  }
  sendDisputeMessage(disputeId: string, body: string): Promise<unknown> {
    return this.post(`/disputes/${disputeId}/messages`, { body });
  }
  reopenDispute(disputeId: string): Promise<unknown> {
    return this.post(`/disputes/${disputeId}/reopen`, {});
  }
  adminDisputeQueue(role?: string): Promise<unknown[]> {
    return this.get(`/admin/disputes/queue${role ? `?role=${role}` : ''}`) as Promise<unknown[]>;
  }
  adminMyDisputes(): Promise<unknown[]> {
    return this.get('/admin/disputes/mine') as Promise<unknown[]>;
  }
  adminResolvedDisputes(role?: string): Promise<unknown[]> {
    return this.get(`/admin/disputes/resolved${role ? `?role=${role}` : ''}`) as Promise<unknown[]>;
  }
  adminDisputeCounts(): Promise<Record<string, number>> {
    return this.get('/admin/disputes/counts') as Promise<Record<string, number>>;
  }
  adminAssignDispute(id: string): Promise<unknown> {
    return this.post(`/admin/disputes/${id}/assign`, {});
  }
  adminResolveDispute(id: string): Promise<unknown> {
    return this.post(`/admin/disputes/${id}/resolve`, {});
  }
  adminDisputeThread(id: string): Promise<unknown> {
    return this.get(`/admin/disputes/${id}/messages`);
  }
  adminSendDisputeMessage(id: string, body: string): Promise<unknown> {
    return this.post(`/admin/disputes/${id}/messages`, { body });
  }

  // ---- Coupons ----
  /** Public: coupons available for a specific shop. */
  shopCoupons(shopId: string): Promise<unknown[]> {
    return this.get(`/coupons/shop/${shopId}`) as Promise<unknown[]>;
  }
  /** Customer: validate a coupon code before placing order. */
  validateCoupon(code: string, shopId: string, subtotalPaise: number): Promise<unknown> {
    return this.post('/coupons/validate', { code, shopId, subtotalPaise });
  }
  /** Admin: create a coupon. */
  adminCreateCoupon(body: {
    code: string; type: string; value?: number; description?: string;
    minOrderPaise?: number; maxUses?: number | null; maxUsesPerUser?: number | null;
    validFrom?: string | null; expiresAt?: string | null; active?: boolean; shopIds?: string[];
  }): Promise<unknown> {
    return this.post('/admin/coupons', body);
  }
  /** Admin: list all coupons. */
  adminListCoupons(all = false): Promise<unknown[]> {
    return this.get(`/admin/coupons${all ? '?all=true' : ''}`) as Promise<unknown[]>;
  }
  /** Admin: update a coupon. */
  adminUpdateCoupon(id: string, body: Record<string, unknown>): Promise<unknown> {
    return this.patch(`/admin/coupons/${id}`, body);
  }
  /** Admin: delete (soft) a coupon. */
  adminDeleteCoupon(id: string): Promise<unknown> {
    return this.delete(`/admin/coupons/${id}`);
  }

  // ---- Serviceable cities ----
  /** Public: enabled cities with their active offer templates. */
  serviceableCities(): Promise<Array<{ name: string; deliveryRadiusMeters: number; offers: Array<{ id: string; title: string; type: string; value: number; minOrderPaise: number }> }>> {
    return this.get('/cities/serviceable');
  }
  /** Owner: all cities (enabled + disabled), incl. their collection UPI and assigned admin. */
  ownerListCities(): Promise<
    Array<{
      id: string;
      name: string;
      enabled: boolean;
      collectionUpiVpa: string | null;
      collectionUpiName: string | null;
      admin: { phone: string | null } | null;
    }>
  > {
    return this.get('/cities');
  }
  ownerUpsertCity(
    name: string,
    opts: { enabled?: boolean; collectionUpiVpa?: string; collectionUpiName?: string; deliveryRadiusMeters?: number; riderCheckRadiusMeters?: number; deliveryTiersJson?: string } = {},
  ): Promise<unknown> {
    return this.post('/cities', { name, enabled: opts.enabled ?? true, ...opts });
  }
  ownerSetCityEnabled(id: string, enabled: boolean): Promise<unknown> {
    return this.patch(`/cities/${id}`, { enabled });
  }
  ownerListCityOffers(cityId: string): Promise<Array<{ id: string; title: string; type: string; value: number; minOrderPaise: number; active: boolean }>> {
    return this.get(`/cities/${cityId}/offers`);
  }
  ownerCreateCityOffer(cityId: string, body: { title: string; type: string; value: number; minOrderPaise?: number }): Promise<unknown> {
    return this.post(`/cities/${cityId}/offers`, body);
  }
  ownerUpdateCityOffer(offerId: string, body: { title?: string; value?: number; minOrderPaise?: number; active?: boolean }): Promise<unknown> {
    return this.patch(`/cities/offers/${offerId}`, body);
  }
  ownerDeleteCityOffer(offerId: string): Promise<{ deleted: true }> {
    return this.delete(`/cities/offers/${offerId}`);
  }

  // ---- Rider (platform delivery) ----
  registerRider(body: { name: string; vehicle?: string }): Promise<{ accessToken: string }> {
    return this.post('/riders/register', body);
  }
  riderMe(): Promise<{
    online: boolean; vehicle: string | null; earningsPaise: number; duesPaise: number; creditLimitPaise: number;
    collectionUpi: { vpa: string; name: string } | null;
  }> {
    return this.get('/riders/me');
  }
  /** Recent system notifications (penalty alerts, stale order releases, escalations). */
  riderNotifications(): Promise<Array<{ id: string; action: string; message: string; orderId: string | null; createdAt: string; isWarning: boolean }>> {
    return this.get('/riders/me/notifications');
  }
  riderSetOnline(online: boolean, latitude?: number, longitude?: number): Promise<{ online: boolean }> {
    return this.patch('/riders/me/online', { online, latitude, longitude });
  }
  /** Report the rider's live GPS position (used mid-delivery for customer tracking). */
  riderUpdateLocation(latitude: number, longitude: number): Promise<{ ok: true }> {
    return this.patch('/riders/me/location', { latitude, longitude });
  }
  riderJobs(): Promise<unknown[]> {
    return this.get('/riders/jobs');
  }
  /** The rider's ACTIVE deliveries (claimed, in-hand). Small bounded set. */
  riderDeliveries(): Promise<unknown[]> {
    return this.get('/riders/deliveries');
  }
  /** The rider's completed-delivery history, keyset paginated. */
  riderDeliveryHistory(opts: PageParams = {}): Promise<Paginated<unknown>> {
    return this.get(`/riders/deliveries/history${pageQuery(opts)}`);
  }
  riderAccept(orderId: string): Promise<{ accepted: true }> {
    return this.post(`/riders/jobs/${orderId}/accept`, {});
  }
  /** Decline the job currently offered to this rider (re-offers to the next nearest). */
  riderDeclineJob(orderId: string): Promise<{ declined: true }> {
    return this.post(`/riders/jobs/${orderId}/decline`, {});
  }
  /** Confirm pickup at the shop with the shop's rider pickup OTP. */
  riderConfirmPickup(orderId: string, otp: string): Promise<{ status: string }> {
    return this.post(`/riders/deliveries/${orderId}/pickup`, { otp });
  }
  /**
   * Complete a delivery with the customer's handoff OTP. For a COD order, pass
   * `codPaidViaUpi: true` when the customer paid the shop's UPI by QR (no rider
   * dues); omit/false when the rider collected cash (dues accrue).
   */
  riderComplete(orderId: string, otp: string, codPaidViaUpi = false): Promise<unknown> {
    return this.post(`/riders/deliveries/${orderId}/complete`, { otp, codPaidViaUpi });
  }
  /** Rider: claim the customer paid a COD order by UPI/QR at the door (shop confirms). */
  riderClaimUpiPaid(orderId: string): Promise<{ claimed: true }> {
    return this.post(`/riders/deliveries/${orderId}/claim-upi`, {});
  }
  /** Rider: file a COD dues deposit claim after paying via UPI — admin approves to clear. */
  claimRiderPayment(amountPaise: number): Promise<{ id: string; status: string }> {
    return this.post('/riders/me/claim-dues-payment', { amountPaise });
  }

  // ---- Owner (super-admin) — admin management ----
  ownerListAdmins(): Promise<
    Array<{
      inviteId: string;
      userId: string;
      phone: string | null;
      email: string | null;
      role: string;
      status: string;
      createdAt: string;
      city: { id: string; name: string } | null;
    }>
  > {
    return this.get('/owner/admins');
  }
  ownerInviteAdmin(body: { phone: string; email?: string }): Promise<unknown> {
    return this.post('/owner/admins/invite', body);
  }
  ownerApproveAdmin(inviteId: string): Promise<unknown> {
    return this.post(`/owner/admins/${inviteId}/approve`, {});
  }
  ownerRevokeAdmin(inviteId: string): Promise<unknown> {
    return this.post(`/owner/admins/${inviteId}/revoke`, {});
  }
  ownerAssignAdminCity(inviteId: string, cityId: string | null): Promise<void> {
    return this.patch(`/owner/admins/${inviteId}/city`, { cityId });
  }

  // ---- Admin taskboard + automation log ----
  adminTaskboard(): Promise<{
    summary: { pendingKyc: number; pendingClaims: number; refundPending: number; pausedShops: number };
    items: Array<
      | { type: 'KYC'; shopId: string; shopName: string; city: string | null; since: string }
      | { type: 'PAYMENT_CLAIM'; claimId: string; entityType: string; entityName: string; amountPaise: number; since: string }
      | { type: 'REFUND'; orderId: string; orderRef: string; shopName: string; amountPaise: number; since: string }
      | { type: 'SHOP_PAUSED'; shopId: string; shopName: string; duesPaise: number; limitPaise: number; since: string }
    >;
    automationLog: Array<{
      id: string; action: string; detail: string;
      orderId: string | null; shopId: string | null; riderUserId: string | null;
      revertedAt: string | null; revertedById: string | null; revertNote: string | null;
      createdAt: string;
    }>;
  }> {
    return this.get('/admin/taskboard');
  }
  adminRevertAutomation(logId: string, note?: string): Promise<{ reverted: true }> {
    return this.patch(`/admin/automation/${logId}/revert`, { note });
  }
  /** Admin: force-cancel any non-terminal order. */
  adminCancelOrder(orderId: string, reason: string): Promise<{ cancelled: true }> {
    return this.post(`/admin/orders/${orderId}/cancel`, { reason });
  }
  /** Admin: assign additional riders to a heavy order (>20 kg). */
  adminAssignAdditionalRiders(orderId: string, riderUserIds: string[]): Promise<{ additionalRiderIds: string[] }> {
    return this.post(`/admin/orders/${orderId}/assign-riders`, { riderUserIds });
  }

  // ---- Orders (customer) ----
  placeOrder(body: Omit<CreateOrder, 'shopId' | 'items'>): Promise<PlaceOrderResult> {
    return this.post('/orders', body);
  }
  orderHistory(opts: PageParams = {}): Promise<Paginated<unknown>> {
    return this.get(`/orders/history${pageQuery(opts)}`);
  }
  order(id: string): Promise<unknown> {
    return this.get(`/orders/${id}`);
  }
  /** Customer: claim payment sent ("I've paid"). The shop verifies it. */
  confirmPayment(id: string): Promise<unknown> {
    return this.post(`/orders/${id}/confirm-payment`, {});
  }
  reorder(id: string): Promise<unknown> {
    return this.post(`/orders/${id}/reorder`, {});
  }

  // ---- Shopkeeper ----
  registerShop(body: unknown): Promise<{ shop: unknown; accessToken: string }> {
    return this.post('/shops', body);
  }
  myShop(): Promise<unknown> {
    return this.get('/shops/me');
  }
  /** All shops owned by the caller (multi-shop picker). */
  myShops(): Promise<Array<{ id: string; name: string; verificationStatus: string; isOpen: boolean; city?: string }>> {
    return this.get('/shops/mine/all');
  }
  /** Switch active shop → returns a fresh scoped token (call setToken with it). */
  switchShop(shopId: string): Promise<{ accessToken: string; shopId: string }> {
    return this.post(`/shops/switch/${shopId}`, {});
  }
  setStoreOpen(isOpen: boolean): Promise<{ isOpen: boolean }> {
    return this.patch('/shops/me/open', { isOpen });
  }
  /** Close all owned shops server-side, then the caller should drop the token. */
  logoutUser(): Promise<{ ok: true }> {
    return this.post('/auth/logout', {});
  }
  /** Shopkeeper: offer usage stats (how many orders used each offer on their shop). */
  myOfferStats(): Promise<Array<{ offerId: string; usedCount: number }>> {
    return this.get('/shops/me/offer-stats') as Promise<Array<{ offerId: string; usedCount: number }>>;
  }
  /** Update shop economics + profile + working hours. */
  updateShopSettings(body: {
    city?: string;
    addressLine?: string;
    contactPhone?: string;
    upiVpa?: string;
    gstin?: string;
    stateCode?: string;
    legalName?: string;
    deliveryFeePaise?: number;
    freeDeliveryAbovePaise?: number;
    minOrderValuePaise?: number;
    workingHours?: Record<string, { open: string; close: string }>;
    platformDeliveryEnabled?: boolean;
    selfPickupEnabled?: boolean;
    offerText?: string;
    activeOfferIds?: string[] | null;
  }): Promise<unknown> {
    return this.patch('/shops/me/settings', body);
  }
  /** Shopkeeper: their own categories + CRUD. */
  myCategories(): Promise<Array<{ id: string; name: string }>> {
    return this.get('/categories/mine');
  }
  createCategory(name: string): Promise<{ id: string; name: string }> {
    return this.post('/categories', { name });
  }
  deleteCategory(id: string): Promise<unknown> {
    return this.delete(`/categories/${id}`);
  }
  submitKyc(body: unknown): Promise<unknown> {
    return this.post('/shops/me/kyc', body);
  }
  myProducts(): Promise<unknown[]> {
    return this.get('/products/mine');
  }
  createProduct(body: unknown): Promise<unknown> {
    return this.post('/products', body);
  }
  /** Shopkeeper: update a product (partial) in their own shop. */
  updateProduct(
    id: string,
    body: Partial<{
      name: string;
      pricePaise: number;
      mrpPaise: number;
      stock: number;
      imageUrl: string;
      available: boolean;
      categoryId: string;
      weightGrams: number;
    }>,
  ): Promise<unknown> {
    return this.patch(`/products/${id}`, body);
  }
  deleteProduct(id: string): Promise<unknown> {
    return this.delete(`/products/${id}`);
  }
  /**
   * Shopkeeper feed for one UI tab, keyset paginated. `status` is a
   * comma-separated status set (the tab's statuses); page 1 omits the cursor.
   */
  orderFeed(status?: string, opts: PageParams = {}): Promise<Paginated<unknown>> {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (opts.limit != null) q.set('limit', String(opts.limit));
    if (opts.cursor) q.set('cursor', opts.cursor);
    const qs = q.toString();
    return this.get(`/orders/feed${qs ? `?${qs}` : ''}`);
  }
  /** Per-status order counts for the feed tab badges. */
  orderFeedCounts(): Promise<Record<string, number>> {
    return this.get('/orders/feed/counts');
  }
  /** Unified feed across all shops owned by the logged-in shopkeeper. */
  orderFeedAll(status?: string, opts: PageParams = {}): Promise<Paginated<unknown>> {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (opts.limit != null) q.set('limit', String(opts.limit));
    if (opts.cursor) q.set('cursor', opts.cursor);
    const qs = q.toString();
    return this.get(`/orders/feed/all${qs ? `?${qs}` : ''}`);
  }
  /** Per-status counts across all shops owned by the logged-in shopkeeper. */
  orderFeedAllCounts(): Promise<Record<string, number>> {
    return this.get('/orders/feed/all/counts');
  }
  /** Shopkeeper home analytics: today / last7Days / thisMonth + activeOrders. */
  shopStats(): Promise<{
    today: { orders: number; delivered: number; valuePaise: number };
    last7Days: { orders: number; delivered: number; valuePaise: number };
    thisMonth: { orders: number; delivered: number; valuePaise: number };
    activeOrders: number;
  }> {
    return this.get('/orders/stats');
  }
  advanceOrder(id: string, status: string, reason?: string, otp?: string): Promise<unknown> {
    return this.patch(`/orders/${id}/status`, { status, reason, otp });
  }
  /** Shopkeeper: mark specific order items as unavailable (item substitution). Recomputes the adjusted total. */
  markOrderItemsUnavailable(orderId: string, orderItemIds: string[]): Promise<{ adjustedTotalPaise: number }> {
    return this.patch(`/orders/${orderId}/items/unavailable`, { orderItemIds });
  }
  /** Shopkeeper: verify a customer's payment claim (money received) → PREPARING. */
  shopConfirmPayment(id: string): Promise<unknown> {
    return this.post(`/orders/${id}/payment-received`, {});
  }
  /** Shopkeeper: reject a payment claim (not received) → customer re-prompted. */
  shopRejectPayment(id: string): Promise<unknown> {
    return this.post(`/orders/${id}/payment-not-received`, {});
  }
  /** Shopkeeper: confirm a rider's COD-by-UPI claim (money received at the door). */
  shopConfirmCodUpi(id: string): Promise<unknown> {
    return this.post(`/orders/${id}/cod-upi-received`, {});
  }
  /** Shopkeeper: the rider's COD-by-UPI claim was NOT received → clears it. */
  shopRejectCodUpi(id: string): Promise<unknown> {
    return this.post(`/orders/${id}/cod-upi-not-received`, {});
  }
  /** Shopkeeper ledger + dues summary; entries keyset paginated. */
  myLedger(opts: PageParams = {}): Promise<unknown> {
    return this.get(`/ledger${pageQuery(opts)}`);
  }
  /** Shopkeeper: P&L summary (gross sales, discounts, commission, net position). */
  myPnl(since?: string): Promise<{
    orderCount: number;
    grossSalesPaise: number;
    discountsGivenPaise: number;
    coinsRedeemedPaise: number;
    netItemRevenuePaise: number;
    deliveryFeesPaise: number;
    commissionPaise: number;
    platformFeePaise: number;
    codCollectedByPasswalaPaise: number;
    netPositionPaise: number;
  }> {
    return this.get(`/ledger/pnl${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  }
  /** Shopkeeper: self-settle dues over UPI (amount in paise). Overpay allowed. */
  payDues(amountPaise: number): Promise<{ settled: true; newDuesPaise: number }> {
    return this.post('/ledger/pay', { amountPaise });
  }
  /** Shopkeeper: file a payment claim after opening UPI — admin approves to clear dues. */
  claimShopPayment(amountPaise: number): Promise<{ id: string; status: string }> {
    return this.post('/ledger/claim-payment', { amountPaise });
  }

  // ---- Account ----
  me(): Promise<unknown> {
    return this.get('/account/me');
  }
  deleteAccount(): Promise<{ deleted: true }> {
    return this.delete('/account/me');
  }

  // ---- Media upload ----
  /**
   * Upload an image file (multipart/form-data). `file` is a Blob/File (web) or
   * an RN file object ({ uri, name, type }). Returns the public URL to store on
   * a shop/product. Uses the raw fetch so the browser sets the multipart
   * boundary; the auth header is attached manually.
   */
  async uploadImage(file: Blob | { uri: string; name: string; type: string }): Promise<{ url: string; filename: string }> {
    const form = new FormData();
    // Both Blob (web) and the RN {uri,name,type} shape are accepted by FormData.
    form.append('file', file as Blob);
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await this.fetchImpl(`${this.baseUrl}/uploads/image`, {
      method: 'POST',
      headers, // do NOT set Content-Type — the runtime sets the multipart boundary
      body: form,
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      throw new ApiError(res.status, (parsed?.message as string) ?? 'Upload failed', parsed);
    }
    return parsed as { url: string; filename: string };
  }

  // ---- low-level HTTP ----
  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }
  private patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }
  private delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      // 401 = expired/invalid session. Clear the token and notify the app so it
      // can route to login, then throw a typed AuthExpiredError. The @Public
      // auth routes (login) also 401 on a bad OTP in prod — but the dev bypass
      // means login succeeds; a 401 here always means an expired bearer token.
      if (res.status === 401) {
        this.setToken(undefined);
        this.onUnauthorized?.();
        throw new AuthExpiredError();
      }
      const message =
        (parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message: unknown }).message)
          : res.statusText) || 'Request failed';
      throw new ApiError(res.status, message, parsed);
    }
    return parsed as T;
  }
}
