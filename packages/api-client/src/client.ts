import type {
  CreateOrder,
  PlaceOrderResult,
  POSCreateSale,
  POSSaleResult,
  ProductPublic,
  ProductDetailPublic,
  ProductSearchResult,
  ShopPublic,
  CreateAdCampaign,
  UpdateAdCampaign,
  AdCampaignView,
  AdAnalyticsSummary,
  AdShopCard,
  AdShopDrilldown,
  AdImpressionBatch,
  CreatePrescription,
  QuotePrescription,
  RejectPrescription,
  PrescriptionView,
} from '@passwaala/shared';

/** A discovered nearby shop (public view + distance). */
export interface NearbyShop extends ShopPublic {
  distanceMeters: number;
}

/** A home-carousel banner image shown to the customer (public feed shape). */
export interface Banner {
  id: string;
  imageUrl: string;
  sortOrder: number;
}

/** A banner as the admin manages it (includes targeting + status). */
export interface AdminBanner {
  id: string;
  imageUrl: string;
  cities: string[];
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
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
  /**
   * Called on any failed request (non-2xx) EXCEPT an expired-session 401 (which
   * goes through onUnauthorized instead). Apps wire this to a global toast so
   * every failure surfaces a short, friendly popup. `ctx.method`/`ctx.path` let
   * the app suppress noise (e.g. only pop for user-initiated writes, not polls).
   */
  onError?: (err: ApiError, ctx: { method: string; path: string }) => void;
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
 * Turn any thrown error into ONE short, user-friendly line safe to show in a
 * popup. Never leaks status codes, stack traces, SQL/Prisma internals, or the
 * generic "Internal server error" — those all collapse to a calm retry prompt.
 * Meaningful validation/auth messages from the API (4xx) are passed through as
 * they're already written for humans ("No account found. Please sign up first.",
 * "Incorrect PIN.", "This item is out of stock.").
 */
export function friendlyMessage(err: unknown): string {
  const GENERIC = 'Something went wrong. Please try again.';
  if (err instanceof AuthExpiredError) return err.message;
  if (err instanceof ApiError) {
    // Server-side faults and rate limits: never show the raw body or a code.
    if (err.status >= 500) return GENERIC;
    if (err.status === 429) return 'Too many attempts. Please wait a moment, then try again.';
    const m = (err.message || '').trim();
    // Drop empty, placeholder, or technical-looking messages.
    const technical =
      !m ||
      m === 'Request failed' ||
      /internal server error|\bprisma\b|\bsql\b|econn|\bundefined\b|cannot read|\bnull\b|stack|illegal invocation|\b50\d\b|\b40\d\b/i.test(m);
    if (technical) return GENERIC;
    return m.length > 160 ? `${m.slice(0, 157)}…` : m;
  }
  // fetch() itself rejected → no network / server unreachable.
  const raw = err instanceof Error ? err.message : '';
  if (/network|failed to fetch|load failed|timeout|timed out|abort/i.test(raw)) {
    return 'No internet connection. Please check your network and try again.';
  }
  return GENERIC;
}

/**
 * PasswaalaApiClient — a single typed client for the NearBaz API, shared by the
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
  private onError?: (err: ApiError, ctx: { method: string; path: string }) => void;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.token = opts.token;
    this.onTokenChange = opts.onTokenChange;
    this.onUnauthorized = opts.onUnauthorized;
    this.onError = opts.onError;
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
  /** Sign up with phone + name + password + optional PIN. msg91Token required in production. */
  signup(
    phone: string,
    name: string,
    password: string,
    opts?: { pin?: string; appType?: string; msg91Token?: string },
  ): Promise<{ accessToken: string; role: string }> {
    const { pin, appType, msg91Token } = opts ?? {};
    return this.post('/auth/signup', {
      phone,
      name,
      password,
      ...(pin && { pin }),
      ...(appType && { appType }),
      ...(msg91Token && { msg91Token }),
    });
  }
  /**
   * Log in with phone + a credential. `method` picks the credential type the
   * user chose: 'pin' (4-digit) or 'password'. Omitted → legacy fallback.
   */
  login(
    phone: string,
    credential: string,
    opts?: { method?: 'pin' | 'password'; appType?: string },
  ): Promise<{ accessToken: string; role: string }> {
    const { method, appType } = opts ?? {};
    return this.post('/auth/login', {
      phone,
      credential,
      ...(method && { method }),
      ...(appType && { appType }),
    });
  }
  verifyOtp(phone: string, appType?: string, msg91Token?: string, code?: string): Promise<{ accessToken: string; role: string }> {
    return this.post('/auth/verify-otp', {
      phone,
      ...(appType && { appType }),
      ...(msg91Token && { msg91Token }),
      ...(code && { code }),
    });
  }

  resetCredentials(
    phone: string,
    msg91Token: string,
    opts?: { newPassword?: string; newPin?: string; appType?: string },
  ): Promise<{ ok: true }> {
    const { newPassword, newPin, appType } = opts ?? {};
    return this.post('/auth/reset-credentials', {
      phone,
      msg91Token,
      ...(newPassword && { newPassword }),
      ...(newPin && { newPin }),
      ...(appType && { appType }),
    });
  }

  // ---- Discovery ----
  nearbyShops(params: {
    lat: number;
    lng: number;
    radiusMeters?: number;
    sort?: 'distance' | 'rating';
    openNow?: boolean;
    category?: string;
    /** City filter — applied FIRST server-side so discovery stays fast at scale. */
    city?: string;
    /** Only shops currently running an offer ("Great Offers" pill). */
    hasOffers?: boolean;
    minRating?: number;
    limit?: number;
    offset?: number;
  }): Promise<NearbyShop[]> {
    const q = new URLSearchParams();
    q.set('lat', String(params.lat));
    q.set('lng', String(params.lng));
    if (params.radiusMeters) q.set('radiusMeters', String(params.radiusMeters));
    if (params.sort) q.set('sort', params.sort);
    if (params.openNow) q.set('openNow', 'true');
    if (params.category) q.set('category', params.category);
    if (params.city) q.set('city', params.city);
    if (params.hasOffers) q.set('hasOffers', 'true');
    if (params.minRating != null) q.set('minRating', String(params.minRating));
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    return this.get(`/shops/nearby?${q.toString()}`);
  }
  /**
   * Premium (admin-curated) shops near a location — a distinct, NON-billed
   * section (not paid ads). City-first filter for speed at scale.
   */
  premiumShops(params: {
    lat: number;
    lng: number;
    radiusMeters?: number;
    city?: string;
    limit?: number;
    offset?: number;
  }): Promise<NearbyShop[]> {
    const q = new URLSearchParams();
    q.set('lat', String(params.lat));
    q.set('lng', String(params.lng));
    if (params.radiusMeters) q.set('radiusMeters', String(params.radiusMeters));
    if (params.city) q.set('city', params.city);
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    return this.get(`/shops/premium?${q.toString()}`);
  }
  /** Lazy per-shop delivery-availability check (cheap; call when opening a shop). */
  shopDeliveryAvailable(shopId: string): Promise<{ deliveryAvailable: boolean; selfPickupEnabled: boolean }> {
    return this.get(`/shops/${shopId}/delivery-available`);
  }
  shop(id: string): Promise<ShopPublic> {
    return this.get(`/shops/${id}`);
  }
  shopProducts(shopId: string): Promise<ProductPublic[]> {
    return this.get(`/products?shopId=${shopId}`);
  }
  /** Public: one product's detail (name+price+description), loaded lazily on tap. */
  productDetail(id: string): Promise<ProductDetailPublic> {
    return this.get(`/products/${id}`);
  }
  /** Search/filter a shop's catalog by name and/or category. */
  searchProducts(shopId: string, opts: { q?: string; categoryId?: string } = {}): Promise<ProductPublic[]> {
    const p = new URLSearchParams({ shopId });
    if (opts.q) p.set('q', opts.q);
    if (opts.categoryId) p.set('categoryId', opts.categoryId);
    return this.get(`/products?${p.toString()}`);
  }
  /**
   * Cross-shop product search near a location. Returns matching products with
   * their owning shop, ranked nearest-first; paginated (a few results first,
   * more on scroll via `offset`).
   */
  searchProductsNearby(params: {
    lat: number;
    lng: number;
    q: string;
    radiusMeters?: number;
    city?: string;
    limit?: number;
    offset?: number;
  }): Promise<ProductSearchResult> {
    const p = new URLSearchParams();
    p.set('lat', String(params.lat));
    p.set('lng', String(params.lng));
    p.set('q', params.q);
    if (params.radiusMeters != null) p.set('radiusMeters', String(params.radiusMeters));
    if (params.city) p.set('city', params.city);
    if (params.limit != null) p.set('limit', String(params.limit));
    if (params.offset != null) p.set('offset', String(params.offset));
    return this.get(`/products/search?${p.toString()}`);
  }
  /** Public: a shop's categories (for the drill-down). */
  shopCategories(shopId: string): Promise<Array<{ id: string; name: string }>> {
    return this.get(`/categories?shopId=${shopId}`);
  }

  // ---- Sponsored Ads (CPC) ----
  /** Customer: report a tap on a sponsored shop card (CPC-billed once/customer/day). */
  adClick(campaignId: string): Promise<{ ok: true }> {
    return this.post(`/ads/${campaignId}/click`, {});
  }
  /** Customer: batch-report sponsored cards shown this render (unbilled analytics). */
  adImpressions(campaignIds: string[]): Promise<{ ok: true }> {
    const body: AdImpressionBatch = { campaignIds };
    return this.post('/ads/impressions', body);
  }
  /** Shopkeeper: this shop's own ads drill-down (impressions/clicks/spend + dues). */
  myAds(): Promise<AdShopDrilldown> {
    return this.get('/shops/me/ads');
  }
  /** Shopkeeper: opt into ads (create/activate a campaign at the city default CPC). */
  optInAds(opts: { totalBudgetPaise?: number; dailyBudgetPaise?: number } = {}): Promise<AdCampaignView> {
    return this.post('/shops/me/ads/opt-in', opts);
  }
  /** Shopkeeper: pause/resume own campaign. */
  setAdActive(campaignId: string, active: boolean): Promise<AdCampaignView> {
    return this.patch(`/shops/me/ads/${campaignId}/active`, { active });
  }
  /** Shopkeeper: set own daily spend cap (paise; 0 = no cap). */
  setAdDailyBudget(campaignId: string, dailyBudgetPaise: number): Promise<AdCampaignView> {
    return this.patch(`/shops/me/ads/${campaignId}/daily-budget`, { dailyBudgetPaise });
  }
  // Admin ads back office
  adminCreateCampaign(dto: CreateAdCampaign): Promise<AdCampaignView> {
    return this.post('/admin/ads/campaigns', dto);
  }
  adminUpdateCampaign(id: string, dto: UpdateAdCampaign): Promise<AdCampaignView> {
    return this.patch(`/admin/ads/campaigns/${id}`, dto);
  }
  adminDeleteCampaign(id: string): Promise<{ ok: true }> {
    return this.delete(`/admin/ads/campaigns/${id}`);
  }
  /** Admin: global ads analytics (totals + per-campaign + time series), city-scoped. */
  adminAdsAnalytics(rangeDays?: number): Promise<AdAnalyticsSummary> {
    const q = rangeDays != null ? `?range=${rangeDays}` : '';
    return this.get(`/admin/ads/analytics${q}`);
  }
  /** Admin: all shops as cards with per-shop ad rollups (city-scoped). */
  adminAdsShops(): Promise<AdShopCard[]> {
    return this.get('/admin/ads/shops');
  }
  /** Admin: one shop's ads drill-down. */
  adminAdsShopDrilldown(shopId: string, rangeDays?: number): Promise<AdShopDrilldown> {
    const q = rangeDays != null ? `?range=${rangeDays}` : '';
    return this.get(`/admin/ads/shops/${shopId}${q}`);
  }
  /** Admin: curate a shop into (or out of) the Premium section (NOT billed). */
  adminSetPremium(shopId: string, isPremium: boolean): Promise<{ ok: true }> {
    return this.patch(`/admin/ads/shops/${shopId}/premium`, { isPremium });
  }

  // ---- Medical-store Prescriptions ----
  /** Customer: submit a prescription (image URLs + delivery choice) to a medical shop. */
  createPrescription(dto: CreatePrescription): Promise<PrescriptionView> {
    return this.post('/prescriptions', dto);
  }
  /** Customer: their own prescriptions (newest first). */
  myPrescriptions(): Promise<PrescriptionView[]> {
    return this.get('/prescriptions/mine');
  }
  /** Shopkeeper: this shop's prescription queue. */
  shopPrescriptions(): Promise<PrescriptionView[]> {
    return this.get('/prescriptions/shop');
  }
  /** Either party: one prescription's detail (authorized as its customer or shop). */
  prescription(id: string): Promise<PrescriptionView> {
    return this.get(`/prescriptions/${id}`);
  }
  /** Shopkeeper: build the itemized bill → creates the order the customer pays. */
  quotePrescription(id: string, dto: QuotePrescription): Promise<PrescriptionView> {
    return this.post(`/prescriptions/${id}/quote`, dto);
  }
  /** Shopkeeper: reject a prescription it can't read/fulfil. */
  rejectPrescription(id: string, dto: RejectPrescription): Promise<PrescriptionView> {
    return this.post(`/prescriptions/${id}/reject`, dto);
  }

  // ---- Referrals / NearBaz Coins ----
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
  /**
   * Replace the ENTIRE server cart in one request (shop + all lines) and get the
   * bill view back once. The fast checkout sync — one round-trip instead of
   * clear + one-add-per-line + GET.
   */
  replaceCart(body: {
    shopId: string;
    items: Array<{ productId: string; qty: number }>;
    deliveryMode?: string;
    addressId?: string;
    selectedOfferId?: string;
  }): Promise<unknown> {
    return this.post('/cart/replace', body);
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
  adminShopDetail(shopId: string): Promise<unknown> {
    return this.get(`/admin/shops/${shopId}/detail`);
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
  /** Admin: enable or disable COD for a specific shop. */
  adminSetShopCodEnabled(shopId: string, enabled: boolean): Promise<{ codEnabled: boolean }> {
    return this.post(`/admin/shops/${shopId}/cod-toggle`, { enabled });
  }
  /** Admin/owner: all riders with earnings + COD dues + active orders. */
  adminListRiders(city?: string): Promise<Array<{
    userId: string; name: string | null; phone: string | null; vehicle: string | null;
    serviceCity: string | null;
    online: boolean; earningsPaise: number; duesPaise: number; creditLimitPaise: number;
    totalDeliveries: number; todayDeliveries: number; cities: string[]; loginOtp: string | null; loginPin: string | null;
    activeOrders: Array<{
      orderId: string; orderRef: string; status: string;
      shopName: string | null; totalPaise: number; paymentMethod: string;
    }>;
  }>> {
    const qs = city?.trim() ? `?${new URLSearchParams({ city: city.trim() }).toString()}` : '';
    return this.get(`/admin/riders${qs}`);
  }
  /** Admin/owner: full detail for one rider — profile + KYC + recent orders. */
  adminRiderDetail(userId: string): Promise<{
    userId: string; name: string | null; phone: string | null; shortId: string | null;
    serviceCity: string | null; vehicle: string | null; online: boolean;
    earningsPaise: number; duesPaise: number; creditLimitPaise: number; joinedAt: string;
    kyc: {
      fullName: string; aadhaar: string; pan: string | null; dlNumber: string;
      vehicleNumber: string | null; emergencyName: string | null; emergencyPhone: string | null;
      photoUrl: string | null; docUrls: string[]; submittedAt: string; updatedAt: string;
    } | null;
    recentOrders: Array<{
      orderId: string; orderRef: string; status: string; createdAt: string;
      shopName: string | null; city: string | null; totalPaise: number; paymentMethod: string;
    }>;
  }> {
    return this.get(`/admin/riders/${userId}`);
  }
  /** Admin/owner: record a rider's COD cash deposit → clears their dues. */
  adminRecordRiderPayment(userId: string): Promise<{ settled: true; clearedPaise: number }> {
    return this.post(`/admin/riders/${userId}/record-payment`, {});
  }
  /** Admin/owner: all customers with coin balance + order stats. Optional `q` filters name/phone. */
  adminListCustomers(q?: string): Promise<Array<{
    userId: string; name: string | null; phone: string | null; shortId: string | null;
    coinBalance: number; joinedAt: string; loginPin: string | null; loginOtp: string | null;
    totalOrders: number; deliveredOrders: number;
  }>> {
    const qs = q?.trim() ? `?${new URLSearchParams({ q: q.trim() }).toString()}` : '';
    return this.get(`/admin/customers${qs}`);
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
  adminListOrders(opts?: { limit?: number; cursor?: string; status?: string; q?: string }): Promise<unknown> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.cursor) params.set('cursor', opts.cursor);
    if (opts?.status) params.set('status', opts.status);
    if (opts?.q) params.set('q', opts.q);
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
  /** Customer: request cancellation. Instant for early statuses; goes to shop for PREPARING. */
  requestCancelOrder(orderId: string, reason: string): Promise<{ cancelled: boolean; requiresShopApproval: boolean; feePaise: number }> {
    return this.post(`/orders/${orderId}/cancel-request`, { reason });
  }
  /** Shopkeeper: approve a customer's cancel request. */
  approveCancelRequest(orderId: string): Promise<{ approved: true; feePaise: number }> {
    return this.post(`/orders/${orderId}/cancel-approve`, {});
  }
  /** Shopkeeper: deny a customer's cancel request. */
  denyCancelRequest(orderId: string): Promise<{ denied: true }> {
    return this.post(`/orders/${orderId}/cancel-deny`, {});
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
    minOrderPaise?: number; maxDiscountPaise?: number | null; maxUses?: number | null; maxUsesPerUser?: number | null;
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

  // ---- Home banners ----
  /** Public: active home-carousel banners for a city (empty-city banners always show). */
  homeBanners(city?: string): Promise<Banner[]> {
    const q = city ? `?city=${encodeURIComponent(city)}` : '';
    return this.get(`/banners${q}`);
  }
  /** Admin: list banners (all = include inactive). */
  adminListBanners(all = false): Promise<AdminBanner[]> {
    return this.get(`/admin/banners${all ? '?all=true' : ''}`);
  }
  /** Admin: create a banner (image already uploaded via uploadImage). */
  adminCreateBanner(body: { imageUrl: string; cities?: string[]; sortOrder?: number; active?: boolean }): Promise<AdminBanner> {
    return this.post('/admin/banners', body);
  }
  /** Admin: update a banner. */
  adminUpdateBanner(id: string, body: Partial<{ imageUrl: string; cities: string[]; sortOrder: number; active: boolean }>): Promise<AdminBanner> {
    return this.patch(`/admin/banners/${id}`, body);
  }
  /** Admin: delete (soft) a banner. */
  adminDeleteBanner(id: string): Promise<{ ok: true }> {
    return this.delete(`/admin/banners/${id}`);
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
    opts: {
      enabled?: boolean; collectionUpiVpa?: string; collectionUpiName?: string;
      deliveryRadiusMeters?: number; riderCheckRadiusMeters?: number; deliveryTiersJson?: string;
      requireRiderForDelivery?: boolean;
      multiShopSurchargePaise?: number; bulkShopRadiusMeters?: number;
      codMinOrderPaise?: number; codMaxPerDay?: number; codCancelBlockAfter?: number; codCancelWindowDays?: number; codWindowHours?: number;
      autoCancelMinutes?: number; riderOfferWindowSec?: number; maxActiveOrdersPerRider?: number;
      shopReminderMinutes?: number; staleRiderMinutes?: number; nearbyShopsRadiusMeters?: number;
      platformFeePaise?: number; defaultCommissionRate?: number; defaultCreditLimitPaise?: number;
      commissionHolidayDays?: number; onboardingFeePaise?: number;
      referralCustomerCoins?: number; referralShopCoins?: number;
    } = {},
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
  registerRider(body: {
    name: string;
    vehicle?: string;
    serviceCity?: string;
    // KYC (identity + documents) — optional at the API layer, collected by the app.
    fullName?: string;
    aadhaar?: string;
    pan?: string;
    dlNumber?: string;
    vehicleNumber?: string;
    emergencyName?: string;
    emergencyPhone?: string;
    photoUrl?: string;
    docUrls?: string[];
  }): Promise<{ accessToken: string }> {
    return this.post('/riders/register', body);
  }
  riderMe(): Promise<{
    online: boolean; vehicle: string | null; earningsPaise: number; duesPaise: number; creditLimitPaise: number;
    collectionUpi: { vpa: string; name: string } | null;
    serviceCity?: string;
    deliveryTiers?: Array<{ maxKm: number; feePaise: number }>;
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
  /** Admin: assign additional riders to a bulk order. */
  adminAssignAdditionalRiders(orderId: string, riderUserIds: string[]): Promise<{ additionalRiderIds: string[] }> {
    return this.post(`/admin/orders/${orderId}/assign-riders`, { riderUserIds });
  }
  /** Admin: mark partial delivery — some items not received. Opens a dispute. */
  adminMarkPartialDelivery(orderId: string, fulfilledItemIds: string[]): Promise<{ delivered: true; adjustedTotalPaise: number; removedCount: number }> {
    return this.post(`/admin/orders/${orderId}/partial-delivery`, { fulfilledItemIds });
  }
  /** Admin: list bulk orders (keyset paginated), newest first. */
  adminListBulkOrders(opts: PageParams = {}): Promise<Paginated<unknown>> {
    return this.get(`/admin/bulk-orders${pageQuery(opts)}`);
  }

  /** Admin: detail for one bulk order. */
  adminBulkOrder(id: string): Promise<unknown> {
    return this.get(`/admin/bulk-orders/${id}`);
  }
  adminUpdateOrderDeliveryFee(orderId: string, newFeePaise: number): Promise<{ deliveryFeePaise: number; extraDeliveryDuePaise: number; isPrepaid: boolean }> {
    return this.post(`/admin/orders/${orderId}/delivery-fee`, { newFeePaise });
  }

  // ---- Orders (customer) ----
  placeOrder(body: Omit<CreateOrder, 'shopId' | 'items'>): Promise<PlaceOrderResult> {
    return this.post('/orders', body);
  }
  /** Shopkeeper: ring up an in-store POS (counter) cash sale. Shop-scoped via the
   *  JWT (server ignores any shopId in the body). Idempotent — the same key
   *  returns the already-created sale (safe for offline replay). */
  posCreateSale(body: POSCreateSale): Promise<POSSaleResult> {
    return this.post('/orders/pos', body);
  }
  orderHistory(opts: PageParams & { mode?: 'ongoing' | 'history' } = {}): Promise<Paginated<unknown>> {
    const { mode, ...page } = opts;
    const qs = pageQuery(page);
    const sep = qs ? '&' : '?';
    return this.get(`/orders/history${qs}${mode ? `${sep}mode=${mode}` : ''}`);
  }
  order(id: string): Promise<unknown> {
    return this.get(`/orders/${id}`);
  }
  /** Customer: append items to a live order. Returns updated total + due-at-delivery amount for prepaid orders. */
  addItemsToOrder(orderId: string, items: Array<{ productId: string; qty: number }>): Promise<{ addedCount: number; newTotalPaise: number; addedItemsDuePaise: number; isPrepaid: boolean }> {
    return this.post(`/orders/${orderId}/add-items`, { items });
  }
  /** Customer: claim payment sent ("I've paid"). The shop verifies it. */
  confirmPayment(id: string): Promise<unknown> {
    return this.post(`/orders/${id}/confirm-payment`, {});
  }
  reorder(id: string): Promise<unknown> {
    return this.post(`/orders/${id}/reorder`, {});
  }

  // ---- Bulk Orders (customer) ----
  placeBulkOrder(body: {
    shops: Array<{ shopId: string; items: Array<{ productId: string; qty: number }> }>;
    addressId: string;
    paymentMethod: string;
    idempotencyKey: string;
    redeemCoins?: number;
  }): Promise<{ bulkOrderId: string; shortId: string; orderIds: string[]; totalPaise: number; pickupOtp: string }> {
    return this.post('/bulk-orders', body);
  }
  bulkOrder(id: string): Promise<unknown> {
    return this.get(`/bulk-orders/${id}`);
  }
  bulkOrderHistory(opts: PageParams = {}): Promise<Paginated<unknown>> {
    return this.get(`/bulk-orders${pageQuery(opts)}`);
  }
  /** Nearby shops within 1 km of an anchor shop — for the multi-shop cart banner. */
  nearbyShopsForBulk(anchorShopId: string, offset = 0): Promise<{ items: Array<{ id: string; name: string; city: string; latitude: number; longitude: number; distanceMeters: number }>; hasMore: boolean }> {
    return this.get(`/shops/nearby-for-bulk?anchorShopId=${encodeURIComponent(anchorShopId)}&offset=${offset}`);
  }

  // ---- Rider bulk-job routes ----
  riderAcceptBulk(bulkOrderId: string): Promise<{ accepted: true; pickupSequenceJson: string }> {
    return this.post(`/riders/bulk-jobs/${bulkOrderId}/accept`, {});
  }
  riderDeclineBulk(bulkOrderId: string): Promise<{ declined: true }> {
    return this.post(`/riders/bulk-jobs/${bulkOrderId}/decline`, {});
  }
  riderConfirmBulkPickup(subOrderId: string, otp: string): Promise<{ status: string }> {
    return this.post(`/riders/bulk-deliveries/${subOrderId}/pickup`, { otp });
  }
  riderCompleteBulk(bulkOrderId: string, otp: string, codPaidViaUpi = false): Promise<unknown> {
    return this.post(`/riders/bulk-deliveries/${bulkOrderId}/complete`, { otp, codPaidViaUpi });
  }
  /** Rider: claim the customer paid a COD bulk sub-order by UPI/QR at the door (shop confirms). */
  riderClaimBulkSubUpi(subOrderId: string): Promise<{ claimed: true }> {
    return this.post(`/riders/bulk-deliveries/${subOrderId}/claim-upi`, {});
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
  /** Shopkeeper: submit an appeal after rejection or suspension. */
  submitAppeal(message: string): Promise<{ submitted: true }> {
    return this.post('/shops/me/appeal', { message });
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
      description: string;
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
  async uploadImage(
    file: Blob | { uri: string; name: string; type: string },
    opts: { type?: 'shop' | 'product' | 'kyc' | 'prescription' | 'banner'; scopeId?: string } = {},
  ): Promise<{ url: string; filename: string }> {
    const form = new FormData();
    // Both Blob (web) and the RN {uri,name,type} shape are accepted by FormData.
    form.append('file', file as Blob);
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    // Organise uploads into folders: ?type=shop|product|kyc & scopeId=<shopId>.
    const q = new URLSearchParams();
    if (opts.type) q.set('type', opts.type);
    if (opts.scopeId) q.set('scopeId', opts.scopeId);
    const qs = q.toString();
    const res = await this.fetchImpl(`${this.baseUrl}/uploads/image${qs ? `?${qs}` : ''}`, {
      method: 'POST',
      headers, // do NOT set Content-Type — the runtime sets the multipart boundary
      body: form,
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      if (res.status === 401) {
        this.setToken(undefined);
        this.onUnauthorized?.();
        throw new AuthExpiredError();
      }
      const err = new ApiError(res.status, (parsed?.message as string) ?? 'Upload failed', parsed);
      this.onError?.(err, { method: 'POST', path: '/uploads/image' });
      throw err;
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
      const message =
        (parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message: unknown }).message)
          : res.statusText) || 'Request failed';
      // A 401 on an /auth/* attempt (login, signup, verify-otp, reset-credentials)
      // is NOT an expired session — it's a failed credential/OTP/phone check. Surface
      // the REAL server message ("No account found", "Incorrect PIN", "Phone
      // verification failed") instead of the generic "session expired", and never
      // clear a token we didn't send. Only a 401 on an authenticated endpoint means
      // the bearer token expired → clear it, notify the app to route to login.
      if (res.status === 401 && !path.startsWith('/auth/')) {
        this.setToken(undefined);
        this.onUnauthorized?.();
        throw new AuthExpiredError();
      }
      const err = new ApiError(res.status, message, parsed);
      // Fan every non-session-expiry failure out to the app's global error
      // handler (toast). Session-expiry (above) is handled via onUnauthorized.
      this.onError?.(err, { method, path });
      throw err;
    }
    return parsed as T;
  }
}
