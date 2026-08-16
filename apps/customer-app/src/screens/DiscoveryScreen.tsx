import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Banner, NearbyShop } from '@nearbaz/api-client';
import type { ProductSearchHit } from '@nearbaz/shared';
import { api } from '../api';
import { prefetchCheckout, getPrefetchedCheckout } from '../checkoutPrefetch';
import { prefetchShop } from './StorefrontScreen';
import type { ShopContactFields, Address } from '../types';
import { bannerImage, logoImage, formatDistance, formatEta, formatRupees, shadow, theme } from '../theme';
import { Badge, Button, EmptyState, ErrorState, SkeletonBlock } from '../ui';
import { ImageOrInitial } from '../ImageOrInitial';
import { ChevronDown } from '../ChevronDown';
import { useLang } from '../i18n/LanguageContext';
import type { Strings } from '../i18n/strings';
import { getCurrentCoords, openDirections } from '../geo';
import { NearbyShopsMap } from '../components/NearbyShopsMap';
import { useCart } from '../cart';

/** Nearby shops fetched per page in list view — 5 at a time for fast first load. */
const PAGE_SIZE = 5;

/** Cross-shop product-search hits fetched per page — a few shown first. */
const PRODUCT_PAGE = 5;

/** Ad campaign impressions already reported this session (dedupe per campaign). */
const _reportedImpressions = new Set<string>();

/** Module-level shop cache — survives tab switches and back navigation.
 *  Shops are shown instantly from cache; a background refresh updates silently. */
let _cachedShops: NearbyShop[] = [];
let _cacheKey = ''; // lat:lng:sort:category:openNow:hasOffers
let _nextPagePrefetched: NearbyShop[] = []; // next page ready before user scrolls
let _nextPagePrefetchedKey = ''; // filter key the prefetched page was fetched for

function makeCacheKey(lat: number, lng: number, sort: string, category: string, openNow: boolean, hasOffers: boolean) {
  return `${lat.toFixed(3)}:${lng.toFixed(3)}:${sort}:${category}:${openNow}:${hasOffers}`;
}

/**
 * Report sponsored-ad impressions for the shops just rendered. Batches the ad
 * campaign ids of sponsored shops and posts them once per campaign per session
 * (impressions are unbilled analytics — clicks are what's CPC-billed). Fire and
 * forget; never blocks or surfaces errors.
 */
function reportSponsoredImpressions(shops: NearbyShop[]) {
  const ids = shops
    .filter((s) => s.isSponsored && s.adCampaignId && !_reportedImpressions.has(s.adCampaignId))
    .map((s) => s.adCampaignId as string);
  if (ids.length === 0) return;
  ids.forEach((id) => _reportedImpressions.add(id));
  void api.adImpressions(ids).catch(() => undefined);
}

/** Resolved delivery location coordinates. Null until GPS or a saved address
 *  resolves — there is NO hardcoded city fallback. */
type Coords = { lat: number; lng: number };

/** Category chips — slugs are API values (never localized); labels come from `t`. */
function categoriesFor(t: Strings): { slug: string; label: string }[] {
  return [
    { slug: '', label: t.discovery.categoryAll },
    { slug: 'kirana', label: t.discovery.categoryKirana },
    { slug: 'dairy', label: t.discovery.categoryDairy },
    { slug: 'medical', label: t.discovery.categoryMedical },
    { slug: 'fruits-veg', label: t.discovery.categoryFruitsVeg },
    { slug: 'electronics', label: t.discovery.categoryElectronics },
  ];
}

/**
 * DiscoveryScreen — nearby shop discovery (plan → Home & Discovery). Location
 * bar, category chips, sort toggle (distance/rating), open-now filter, and rich
 * shop cards with banner + logo, rating, distance and delivery info.
 */
/** Delivery-location state, owned by App.tsx so it survives shop navigation. */
export type LocState = {
  coords: { lat: number; lng: number } | null;
  placeName: string | null;
  addressPicked: boolean;
  gpsTried: boolean;
};

export function DiscoveryScreen({
  onOpenShop,
  viewMode = 'list',
  onViewModeChange,
  restoredShopId,
  loc,
  onLocChange,
  locHydrated = true,
  onOpenCart,
}: {
  onOpenShop: (shopId: string) => void;
  viewMode?: 'list' | 'map';
  onViewModeChange?: (mode: 'list' | 'map') => void;
  restoredShopId?: string | null;
  loc: LocState;
  onLocChange: (next: LocState) => void;
  /** True once the persisted location has been read from storage — the auto-GPS
   *  effect waits for this so it can't override a restored choice. */
  locHydrated?: boolean;
  /** Switch to the Cart tab (sticky cart bar). Optional so the screen still
   *  renders standalone. */
  onOpenCart?: () => void;
}) {
  const { t } = useLang();
  const CATEGORIES = categoriesFor(t);
  // Local cart snapshot for the sticky cart bar at the bottom of the list.
  const cart = useCart();
  // Initialize from module-level cache for instant display on back navigation
  const [shops, setShops] = useState<NearbyShop[]>(_cachedShops);
  const [loading, setLoading] = useState(_cachedShops.length === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'distance' | 'rating'>('distance');
  const [openNow, setOpenNow] = useState(false);
  // "Great Offers" filter pill — only shops currently running an offer.
  const [hasOffers, setHasOffers] = useState(false);
  // Admin-curated Premium shops (a non-billed "Featured shops" strip). Loaded
  // separately from the ranked list; empty when none are curated nearby.
  const [premiumShops, setPremiumShops] = useState<NearbyShop[]>([]);
  // Promo banner text — the top offer for the detected city (from serviceable
  // cities config), else a friendly fallback. Display-only.
  const [promoText, setPromoText] = useState<string | null>(null);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  // Cross-shop product search — matching products with their owning shop,
  // ranked nearest-first. Paginated: a few (PRODUCT_PAGE) shown first, more on
  // "Show more". Fires only for a real query (>= 2 chars) once we have coords.
  const [productHits, setProductHits] = useState<ProductSearchHit[]>([]);
  const [productHitsLoading, setProductHitsLoading] = useState(false);
  const [productHitsMore, setProductHitsMore] = useState(false);
  const [productHitsMoreLoading, setProductHitsMoreLoading] = useState(false);
  const [selectedShop, setSelectedShop] = useState<NearbyShop | null>(null);
  // Pickup-only confirmation: set to the shop the user tapped that has no
  // delivery available right now (rider offline) but does offer self-pickup.
  const [pickupOnlyShop, setPickupOnlyShop] = useState<NearbyShop | null>(null);
  const [mapRadius, setMapRadius] = useState(10000);
  // City delivery radius from admin config (default 10km until loaded).
  const [cityRadius, setCityRadius] = useState(10000);

  // Location is OWNED by App.tsx (via `loc`) so it persists across opening a
  // shop and coming back, AND across reloads (persisted to IndexedDB). There is
  // NO hardcoded city fallback: coords is null until the user's real GPS fix or
  // a saved address resolves. When null we prompt them to set a location.
  const coords: Coords | null = loc.coords;
  const hasLocation = coords != null;
  const placeName = loc.placeName;
  const [locating, setLocating] = useState(false);
  const geocodedKey = useRef<string | null>(null);

  // City-level name (from the reverse-geocode) used to check serviceability.
  // Null until we reverse-geocode the user's real coords.
  const [detectedCity, setDetectedCity] = useState<string | null>(null);

  // Cities NearBaz currently operates in (enabled city names), loaded once on
  // mount. Null while loading / on failure — we then treat the city as unknown
  // and never show the "not available" state (fail open).
  const [serviceableCities, setServiceableCities] = useState<string[] | null>(null);

  // "Notify me" acknowledgement for the not-available empty state. Persisted
  // per-city in localStorage so the confirmation survives a reload and the user
  // isn't re-prompted for a city they already registered interest in.
  // TODO(server): capture city interest server-side so we can actually notify.
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    if (!detectedCity || typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem('nearbaz.notifiedCities');
      const list: string[] = raw ? JSON.parse(raw) : [];
      setNotified(list.includes(detectedCity.toLowerCase()));
    } catch { /* ignore */ }
  }, [detectedCity]);

  const registerCityInterest = useCallback(() => {
    setNotified(true);
    if (!detectedCity || typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem('nearbaz.notifiedCities');
      const list: string[] = raw ? JSON.parse(raw) : [];
      const key = detectedCity.toLowerCase();
      if (!list.includes(key)) {
        list.push(key);
        localStorage.setItem('nearbaz.notifiedCities', JSON.stringify(list));
      }
    } catch { /* ignore */ }
  }, [detectedCity]);

  // Saved addresses for the delivery location picker. Seed instantly from the
  // checkout prefetch cache (shared with the cart) if it's warm, so opening
  // "change address" on the home screen is instant; otherwise fetch + warm it.
  const [savedAddresses, setSavedAddresses] = useState<Address[]>(
    () => getPrefetchedCheckout()?.addresses ?? [],
  );
  const [showAddrPicker, setShowAddrPicker] = useState(false);
  useEffect(() => {
    prefetchCheckout()
      .then((d) => setSavedAddresses(d.addresses))
      .catch(() => undefined);
  }, []);

  const resolveLocation = useCallback(() => {
    setLocating(true);
    void (async () => {
      const coords = await getCurrentCoords({ timeoutMs: 10000 });
      if (coords) {
        onLocChange({
          coords,
          placeName: null, // reverse-geocode effect fills this
          addressPicked: false,
          gpsTried: true,
        });
      } else {
        // Denied / timeout / unavailable — do NOT silently jump to Jhansi. Just
        // mark tried; the UI shows a "set location" prompt and the user can pick
        // a saved address.
        onLocChange({ ...loc, gpsTried: true });
      }
      setLocating(false);
    })();
  }, [loc, onLocChange]);

  // Auto-run GPS ONCE per session, and never when the user already picked an
  // address (F1/F2) or before the persisted location has hydrated. After the
  // first attempt the chosen location sticks (and is persisted across reloads).
  useEffect(() => {
    if (locHydrated && !loc.gpsTried && !loc.addressPicked) {
      resolveLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locHydrated, loc.gpsTried, loc.addressPicked]);

  // Load the serviceable-city list once on mount. On failure we leave it null
  // (unknown) so we never wrongly tell a user their city isn't covered.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cities = await api.serviceableCities();
        if (!cancelled) {
          setServiceableCities(cities.map(c => c.name));
          // Use the delivery radius of the detected city (or the largest available).
          const match = cities.find(c =>
            detectedCity?.toLowerCase().includes(c.name.toLowerCase()) ||
            c.name.toLowerCase().includes(detectedCity?.toLowerCase() ?? '')
          );
          const radius = match?.deliveryRadiusMeters ?? Math.max(...cities.map(c => c.deliveryRadiusMeters), 10000);
          setCityRadius(radius);
          setMapRadius(radius);
          // Promo banner: prefer a NearBaz-funded (platform) coupon — a real,
          // city-wide discount shown DIRECTLY to the customer with no shop
          // involvement — else fall back to the city's top offer title.
          let promo = match?.offers?.[0]?.title ?? null;
          try {
            const coupons = await api.platformCoupons(match?.name);
            if (coupons.length) {
              const c = coupons[0];
              promo = `🎁 ${c.code}${c.description ? ` — ${c.description}` : ''}`;
            }
          } catch { /* ignore — keep the city offer / fallback */ }
          if (!cancelled) setPromoText(promo);
        }
      } catch {
        if (!cancelled) setServiceableCities(null);
      }
    })();
    return () => { cancelled = true; };
  }, [detectedCity]);

  // Home banner carousel — admin-uploaded promo images targeted to the
  // customer's city. Silent on failure (the carousel simply doesn't render).
  useEffect(() => {
    let cancelled = false;
    api
      .homeBanners(detectedCity ?? undefined)
      .then((r) => { if (!cancelled) setBanners(r); })
      .catch(() => { if (!cancelled) setBanners([]); });
    return () => { cancelled = true; };
  }, [detectedCity]);

  const load = useCallback(async (radiusOverride?: number) => {
    if (!coords) {
      setShops([]);
      setLoading(false);
      return;
    }
    // Only show skeleton on first load; re-fetches keep existing shops visible
    if (shops.length === 0 && _cachedShops.length === 0) setLoading(true);
    setError(null);
    try {
      const isMap = viewMode === 'map';
      const result = await api.nearbyShops({
        lat: coords.lat,
        lng: coords.lng,
        radiusMeters: Math.round(radiusOverride ?? (isMap ? mapRadius : cityRadius)),
        sort,
        openNow: openNow || undefined,
        category: category || undefined,
        hasOffers: hasOffers || undefined,
        city: detectedCity ?? undefined,
        limit: isMap ? 50 : PAGE_SIZE,
        offset: 0,
      });
      setShops(result);
      reportSponsoredImpressions(result);
      setCanLoadMore(!isMap && result.length === PAGE_SIZE);
      if (!isMap) {
        _cachedShops = result;
        _cacheKey = makeCacheKey(coords.lat, coords.lng, sort, category ?? '', openNow, hasOffers);
        // Prefetch products for first 5 visible shops in background
        result.slice(0, 5).forEach(s => prefetchShop(s.id));
      }
      if (restoredShopId && !isMap) {
        const restored = result.find(s => s.id === restoredShopId);
        if (restored) setSelectedShop(restored);
      }
      // Prefetch next page silently so load-more is instant. Tag it with the
      // current filter key so a filter change before load-more discards it
      // (otherwise we'd append shops that don't match the active filters).
      if (!isMap && result.length === PAGE_SIZE) {
        const prefetchKey = makeCacheKey(coords.lat, coords.lng, sort, category ?? '', openNow, hasOffers);
        void api.nearbyShops({
          lat: coords.lat, lng: coords.lng,
          radiusMeters: Math.round(radiusOverride ?? cityRadius),
          sort, openNow: openNow || undefined, category: category || undefined,
          hasOffers: hasOffers || undefined, city: detectedCity ?? undefined,
          limit: PAGE_SIZE, offset: PAGE_SIZE,
        }).then(next => { _nextPagePrefetched = next; _nextPagePrefetchedKey = prefetchKey; }).catch(() => undefined);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [category, sort, openNow, hasOffers, detectedCity, coords, viewMode, mapRadius, cityRadius, restoredShopId]);

  // Load the next page — uses prefetched data when available for instant append.
  const loadMore = useCallback(async () => {
    if (loadingMore || !canLoadMore || viewMode === 'map' || !coords) return;
    setLoadingMore(true);
    const currentKey = makeCacheKey(coords.lat, coords.lng, sort, category ?? '', openNow, hasOffers);
    try {
      // Use prefetched next page if available (avoids a network wait) — but only
      // if it was fetched for the CURRENT filter set. A stale prefetch (filter
      // changed since) is discarded so we never append non-matching shops.
      let next: NearbyShop[];
      if (_nextPagePrefetched.length > 0 && _nextPagePrefetchedKey === currentKey) {
        next = _nextPagePrefetched;
        _nextPagePrefetched = [];
        _nextPagePrefetchedKey = '';
      } else {
        _nextPagePrefetched = [];
        _nextPagePrefetchedKey = '';
        next = await api.nearbyShops({
          lat: coords.lat, lng: coords.lng,
          radiusMeters: Math.round(cityRadius),
          sort, openNow: openNow || undefined, category: category || undefined,
          hasOffers: hasOffers || undefined, city: detectedCity ?? undefined,
          limit: PAGE_SIZE, offset: shops.length,
        });
      }
      setShops((prev) => {
        const updated = [...prev, ...next];
        _cachedShops = updated;
        return updated;
      });
      reportSponsoredImpressions(next);
      setCanLoadMore(next.length === PAGE_SIZE);
      // Prefetch products for newly visible shops
      next.slice(0, 5).forEach(s => prefetchShop(s.id));
      // Pre-fetch the page after this one silently
      const nextOffset = shops.length + next.length;
      if (next.length === PAGE_SIZE) {
        void api.nearbyShops({
          lat: coords.lat, lng: coords.lng,
          radiusMeters: Math.round(cityRadius),
          sort, openNow: openNow || undefined, category: category || undefined,
          hasOffers: hasOffers || undefined, city: detectedCity ?? undefined,
          limit: PAGE_SIZE, offset: nextOffset,
        }).then(prefetched => { _nextPagePrefetched = prefetched; _nextPagePrefetchedKey = currentKey; }).catch(() => undefined);
      }
    } catch {
      /* keep what's loaded */
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, canLoadMore, viewMode, coords, cityRadius, sort, openNow, category, hasOffers, detectedCity, shops.length]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load admin-curated Premium ("Featured") shops for the horizontal strip. This
  // is a distinct, NON-billed section (not paid ads). Only in list view; silent
  // on failure (the strip simply doesn't render).
  useEffect(() => {
    if (!coords || viewMode === 'map') {
      setPremiumShops([]);
      return;
    }
    let cancelled = false;
    api
      .premiumShops({
        lat: coords.lat,
        lng: coords.lng,
        radiusMeters: Math.round(cityRadius),
        city: detectedCity ?? undefined,
        limit: 10,
      })
      .then((r) => { if (!cancelled) setPremiumShops(r); })
      .catch(() => { if (!cancelled) setPremiumShops([]); });
    return () => { cancelled = true; };
  }, [coords, cityRadius, detectedCity, viewMode]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  // Debounced cross-shop product search. Fires 300ms after the user stops
  // typing (>= 2 chars, coords known); clears the hits otherwise. Shows the
  // first PRODUCT_PAGE results; more load on demand.
  const searchTerm = searchQuery.trim();

  // Shop-name search filters only shops already loaded into memory. Because
  // pagination is otherwise scroll-driven (and the list shrinks to the matches
  // while searching, so onEndReached won't fire), auto-pull the remaining pages
  // whenever a search is active. Bounded by the city's shop count — canLoadMore
  // flips false at the last page, ending the chain.
  useEffect(() => {
    if (searchTerm.length >= 1 && canLoadMore && !loadingMore && viewMode !== 'map') {
      void loadMore();
    }
  }, [searchTerm, canLoadMore, loadingMore, viewMode, loadMore]);

  useEffect(() => {
    if (searchTerm.length < 2 || !coords) {
      setProductHits([]);
      setProductHitsLoading(false);
      setProductHitsMore(false);
      return;
    }
    let cancelled = false;
    setProductHitsLoading(true);
    const handle = setTimeout(() => {
      api.searchProductsNearby({
        lat: coords.lat,
        lng: coords.lng,
        q: searchTerm,
        radiusMeters: Math.round(cityRadius),
        limit: PRODUCT_PAGE,
        offset: 0,
      })
        .then((res) => {
          if (cancelled) return;
          setProductHits(res.items);
          setProductHitsMore(res.hasMore);
        })
        .catch(() => {
          if (!cancelled) { setProductHits([]); setProductHitsMore(false); }
        })
        .finally(() => { if (!cancelled) setProductHitsLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [searchTerm, coords, cityRadius]);

  const loadMoreProducts = useCallback(async () => {
    if (productHitsMoreLoading || !productHitsMore || !coords || searchTerm.length < 2) return;
    setProductHitsMoreLoading(true);
    try {
      const res = await api.searchProductsNearby({
        lat: coords.lat,
        lng: coords.lng,
        q: searchTerm,
        radiusMeters: Math.round(cityRadius),
        limit: PRODUCT_PAGE,
        offset: productHits.length,
      });
      setProductHits((prev) => [...prev, ...res.items]);
      setProductHitsMore(res.hasMore);
    } catch {
      // Non-fatal — keep what we have.
    } finally {
      setProductHitsMoreLoading(false);
    }
  }, [productHitsMoreLoading, productHitsMore, coords, searchTerm, cityRadius, productHits.length]);

  // Open a shop, but if it's pickup-only right now (no rider nearby for a
  // platform-delivery shop) first confirm the customer is OK with pickup.
  // Open a shop. Delivery availability is now checked LAZILY here (one cheap
  // per-shop call) rather than scanning all riders for every shop in the list.
  // If a platform-delivery shop has no rider online right now but offers
  // self-pickup, confirm the customer is OK with pickup first.
  // Open the shop IMMEDIATELY — never block navigation on a network call. If the
  // shop is platform-delivery, check rider availability in the BACKGROUND and, if
  // none is available (but self-pickup is on), surface the pickup-only prompt
  // without having made the user wait to enter the shop.
  const handleOpenShop = useCallback((shop: NearbyShop) => {
    onOpenShop(shop.id);
    // Sponsored shops: attribute the click for CPC billing (once-per-customer-
    // per-day dedup is enforced server-side). Fire and forget.
    if (shop.isSponsored && shop.adCampaignId) {
      void api.adClick(shop.adCampaignId).catch(() => undefined);
    }
    const contact = shop as NearbyShop & ShopContactFields;
    // Only platform-delivery shops can be rider-unavailable; self-delivery is
    // always available, so skip the check entirely for them.
    if (contact.platformDeliveryEnabled) {
      void api.shopDeliveryAvailable(shop.id)
        .then((avail) => {
          if (!avail.deliveryAvailable && avail.selfPickupEnabled) {
            setPickupOnlyShop(shop);
          }
        })
        .catch(() => undefined);
    }
  }, [onOpenShop]);

  // Reverse-geocode the current coords to a human place name; writes it back to
  // the lifted loc.placeName. Only runs once we have real coords (GPS or a
  // saved address) — there is no default location to label.
  useEffect(() => {
    if (!coords) {
      setDetectedCity(null);
      return;
    }
    const key = `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}`;
    if (geocodedKey.current === key) return;
    geocodedKey.current = key;

    let cancelled = false;
    (async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.lat}&lon=${coords.lng}&zoom=14`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('geocode failed');
        const data = (await res.json()) as { address?: Record<string, string> };
        const name = buildPlaceName(data.address);
        if (!cancelled && name && !loc.addressPicked) {
          onLocChange({ ...loc, placeName: name });
        }
        if (!cancelled) setDetectedCity(buildCityName(data.address));
      } catch {
        if (!cancelled) setDetectedCity(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [coords]);

  // Only block when a GPS-resolved city is confirmed unserved — never when we
  // have no location yet (we then prompt the user to set one instead).
  const cityUnserved =
    hasLocation &&
    !!detectedCity &&
    serviceableCities !== null &&
    !serviceableCities.some((c) => {
      const a = c.trim().toLowerCase();
      const b = detectedCity!.trim().toLowerCase();
      return a === b || b.includes(a) || a.includes(b);
    });

  return (
    <View style={styles.root}>
      {/* Branded header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.logoMini}>
            <Text style={styles.logoMiniText}>N</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.deliverLabel}>{t.discovery.deliveringTo}</Text>
            <Pressable
              onPress={() => setShowAddrPicker(true)}
              disabled={locating}
              style={styles.locationRow}
            >
              <Text style={styles.locationValue} numberOfLines={1}>
                {locating
                  ? t.discovery.findingLocation
                  : placeName ?? t.locationPicker.setLocation}
              </Text>
              {!locating ? <ChevronDown size={18} color={theme.color.text} /> : null}
            </Pressable>
          </View>
          {/* Map/List toggle — segmented control */}
          <View style={styles.viewToggle}>
            <Pressable
              onPress={() => onViewModeChange?.('list')}
              style={[styles.viewToggleSeg, viewMode === 'list' && styles.viewToggleSegActive]}
            >
              <Text style={[styles.viewToggleSegText, viewMode === 'list' && styles.viewToggleSegTextActive]}>List</Text>
            </Pressable>
            <Pressable
              onPress={() => onViewModeChange?.('map')}
              style={[styles.viewToggleSeg, viewMode === 'map' && styles.viewToggleSegActive]}
            >
              <Text style={[styles.viewToggleSegText, viewMode === 'map' && styles.viewToggleSegTextActive]}>Map</Text>
            </Pressable>
          </View>
        </View>

        {/* Search bar */}
        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            placeholder={t.discovery.searchPlaceholder}
            placeholderTextColor={theme.color.textFaint}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchQuery.length > 0 ? (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <Text style={styles.searchClear}>✕</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Category chips + filters — one compact row: categories scroll (no bar)
          on the left, Open-now / sort pills stay fixed on the right. */}
      <View style={styles.filterBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chipsScroll}
        >
          {CATEGORIES.map((c) => {
            const active = c.slug === category;
            return (
              <Pressable
                key={c.slug || 'all'}
                onPress={() => setCategory(c.slug)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.filterDivider} />
        <View style={styles.filterActions}>
          <Pressable
            onPress={() => setOpenNow((v) => !v)}
            style={[styles.filterPill, openNow && styles.filterPillActive]}
          >
            <Text style={[styles.filterPillText, openNow && styles.filterPillTextActive]}>
              {t.discovery.openNow}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setHasOffers((v) => !v)}
            style={[styles.filterPill, hasOffers && styles.filterPillActive]}
          >
            <Text style={[styles.filterPillText, hasOffers && styles.filterPillTextActive]}>
              {t.discovery.greatOffers}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSort((v) => (v === 'distance' ? 'rating' : 'distance'))}
            style={styles.filterPill}
          >
            <Text style={styles.filterPillText}>
              {sort === 'distance' ? t.discovery.sortDistance : t.discovery.sortRating}
            </Text>
          </Pressable>
        </View>
      </View>

      {!hasLocation && !locating ? (
        <EmptyState
          title={t.locationPicker.setLocation}
          subtitle={t.locationPicker.tapToUseGps}
          action={
            <Button
              label={t.locationPicker.useMyLocation}
              variant="primary"
              fullWidth={false}
              onPress={resolveLocation}
            />
          }
        />
      ) : loading ? (
        <ShopListSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : shops.length === 0 && cityUnserved ? (
        <EmptyState
          title={t.discovery.notAvailableTitle(detectedCity!)}
          subtitle={t.discovery.notAvailableSubtitle}
          action={
            notified ? (
              <Text style={styles.notifiedText}>{t.discovery.notifiedThanks}</Text>
            ) : (
              <Button
                label={t.discovery.notifyMe}
                variant="primary"
                fullWidth={false}
                onPress={registerCityInterest}
              />
            )
          }
        />
      ) : shops.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t.discovery.noMatchTitle}</Text>
          <Text style={styles.emptySub}>{t.discovery.noMatchSubtitle}</Text>
        </View>
      ) : viewMode === 'map' ? (
        <View style={styles.mapWrap}>
          <NearbyShopsMap
            shops={shops.filter((s) => !searchQuery.trim() || s.name.toLowerCase().includes(searchQuery.toLowerCase()))}
            center={coords ?? { lat: 0, lng: 0 }}
            selected={selectedShop}
            onSelect={setSelectedShop}
            radiusMeters={mapRadius}
            onRadiusChange={(r) => {
              const rounded = Math.ceil(r / 500) * 500;
              if (rounded > mapRadius) setMapRadius(rounded);
            }}
          />
          {selectedShop ? (
            <View style={styles.mapSheet}>
              <View style={styles.mapSheetHandle} />
              <View style={styles.mapSheetContent}>
                <View style={styles.mapSheetThumbWrap}>
                  <ImageOrInitial uri={bannerImage(selectedShop.id, selectedShop.storefrontPhotoUrl, 400, 200, selectedShop.name)} name={selectedShop.name} style={styles.mapSheetThumb} />
                  <ImageOrInitial uri={logoImage(selectedShop.id, (selectedShop as NearbyShop & ShopContactFields).logoUrl, 96, selectedShop.name)} name={selectedShop.name} rounded style={styles.mapSheetLogo} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.mapSheetName} numberOfLines={1}>{selectedShop.name}</Text>
                  <Text style={styles.mapSheetMeta} numberOfLines={1}>
                    {[(selectedShop as NearbyShop & ShopContactFields).addressLine, (selectedShop as NearbyShop & ShopContactFields).city].filter(Boolean).join(', ')}
                  </Text>
                  <View style={styles.mapSheetRow}>
                    {selectedShop.offerText ? <Text style={styles.mapOfferTag}>{selectedShop.offerText}</Text> : null}
                    <Text style={styles.mapSheetDist}>{formatDistance(selectedShop.distanceMeters)} · {selectedShop.deliveryFeePaise === 0 ? t.common.free + ' delivery' : formatRupees(selectedShop.deliveryFeePaise)}</Text>
                  </View>
                </View>
                <Pressable onPress={() => setSelectedShop(null)} hitSlop={8} style={styles.mapSheetClose}>
                  <Text style={styles.mapSheetCloseText}>✕</Text>
                </Pressable>
              </View>
              <View style={styles.mapSheetBtns}>
                <Pressable style={styles.mapBtnSecondary} onPress={() => {
                  const sc = selectedShop as NearbyShop & ShopContactFields;
                  const lat = sc.latitude != null ? Number(sc.latitude) : null;
                  const lng = sc.longitude != null ? Number(sc.longitude) : null;
                  if (lat && lng) openDirections({ lat, lng }, selectedShop.name);
                }}>
                  <Text style={styles.mapBtnSecondaryText}>Directions</Text>
                </Pressable>
                {selectedShop.isOpen ? (
                  <Pressable style={styles.mapBtnPrimary} onPress={() => handleOpenShop(selectedShop)}>
                    <Text style={styles.mapBtnPrimaryText}>Open Shop</Text>
                  </Pressable>
                ) : (
                  <View style={[styles.mapBtnPrimary, styles.mapBtnDisabled]}>
                    <Text style={styles.mapBtnDisabledText}>Currently Closed</Text>
                  </View>
                )}
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={shops.filter((s) =>
            !searchQuery.trim() ||
            s.name.toLowerCase().includes(searchQuery.toLowerCase())
          )}
          keyExtractor={(s) => s.id}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={
            searchTerm.length >= 2 ? (
              <ProductHitsSection
                hits={productHits}
                loading={productHitsLoading}
                hasMore={productHitsMore}
                moreLoading={productHitsMoreLoading}
                query={searchTerm}
                onOpenShop={onOpenShop}
                onLoadMore={loadMoreProducts}
                t={t}
              />
            ) : (
              <DiscoveryHeader
                promoText={promoText ?? t.discovery.promoFallback}
                banners={banners}
                premiumShops={premiumShops}
                onOpenShop={handleOpenShop}
                t={t}
              />
            )
          }
          renderItem={({ item }) => <ShopCard shop={item} onPress={() => handleOpenShop(item)} />}
          onEndReached={() => { if (!searchQuery.trim()) void loadMore(); }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} color={theme.color.primary} /> : null}
        />
      )}

      {/* Pickup-only confirmation — shown when a platform-delivery shop has no
          rider nearby but offers self-pickup. */}
      <Modal
        visible={!!pickupOnlyShop}
        transparent
        animationType="fade"
        onRequestClose={() => setPickupOnlyShop(null)}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{t.discovery.pickupOnlyTitle}</Text>
            <Text style={styles.confirmBody}>
              {t.discovery.pickupOnlyBody(pickupOnlyShop?.name ?? '')}
            </Text>
            <View style={styles.confirmActions}>
              <Pressable style={styles.confirmCancel} onPress={() => setPickupOnlyShop(null)}>
                <Text style={styles.confirmCancelText}>{t.common.cancel}</Text>
              </Pressable>
              <Pressable
                style={styles.confirmContinue}
                onPress={() => {
                  const id = pickupOnlyShop?.id;
                  setPickupOnlyShop(null);
                  if (id) onOpenShop(id);
                }}
              >
                <Text style={styles.confirmContinueText}>{t.discovery.pickupOnlyContinue}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Saved address picker */}
      <Modal visible={showAddrPicker} transparent animationType="slide" onRequestClose={() => setShowAddrPicker(false)}>
        <Pressable style={styles.addrPickerOverlay} onPress={() => setShowAddrPicker(false)}>
          <View style={styles.addrPickerSheet}>
            <View style={styles.addrPickerHandle} />
            <Text style={styles.addrPickerTitle}>Deliver to</Text>
            {savedAddresses.map((addr) => (
              <Pressable
                key={addr.id}
                style={({ pressed }) => [styles.addrPickerRow, pressed && { opacity: 0.7 }]}
                onPress={() => {
                  const lat = Number(addr.latitude);
                  const lng = Number(addr.longitude);
                  if (Number.isFinite(lat) && Number.isFinite(lng)) {
                    // User explicitly picked an address → lock out GPS override (F2).
                    onLocChange({
                      coords: { lat, lng },
                      placeName: addr.line,
                      addressPicked: true,
                      gpsTried: true,
                    });
                  }
                  setShowAddrPicker(false);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.addrPickerLabel}>{addr.label}</Text>
                  <Text style={styles.addrPickerLine} numberOfLines={1}>{addr.line}</Text>
                </View>
              </Pressable>
            ))}
            <Pressable style={styles.addrPickerGps} onPress={() => { resolveLocation(); setShowAddrPicker(false); }}>
              <Text style={styles.addrPickerLabel}>Use current location</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Sticky cart bar — floats above the tab bar whenever the local cart has
          items, so the customer can jump straight to checkout from discovery. */}
      {cart.itemCount > 0 && onOpenCart ? (
        <Pressable
          style={({ pressed }) => [styles.cartBar, pressed && { opacity: 0.9 }]}
          onPress={onOpenCart}
        >
          <View style={styles.cartBarLeft}>
            <View style={styles.cartBarCountPill}>
              <Text style={styles.cartBarCountText}>{cart.itemCount}</Text>
            </View>
            <View style={styles.flex}>
              {cart.shopName ? (
                <Text style={styles.cartBarShop} numberOfLines={1}>{cart.shopName}</Text>
              ) : null}
              <Text style={styles.cartBarSummary} numberOfLines={1}>
                {t.discovery.cartBarSummary(cart.itemCount, formatRupees(cart.totalPaise))}
              </Text>
            </View>
          </View>
          <Text style={styles.cartBarCta}>{t.discovery.viewCartCta} →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Placeholder shop-card list shown while the first page of shops loads. */
/**
 * ProductHitsSection — cross-shop product-search results shown above the shop
 * list when the customer is searching. Each hit shows the product + its owning
 * shop (nearest-first); tapping opens that shop. A few load first, more on tap.
 */
function ProductHitsSection({
  hits,
  loading,
  hasMore,
  moreLoading,
  query,
  onOpenShop,
  onLoadMore,
  t,
}: {
  hits: ProductSearchHit[];
  loading: boolean;
  hasMore: boolean;
  moreLoading: boolean;
  query: string;
  onOpenShop: (shopId: string) => void;
  onLoadMore: () => void;
  t: Strings;
}) {
  return (
    <View style={styles.productSection}>
      <Text style={styles.productSectionTitle}>{t.discovery.productsMatching(query)}</Text>
      {loading && hits.length === 0 ? (
        <ActivityIndicator style={{ marginVertical: 12 }} color={theme.color.primary} />
      ) : hits.length === 0 ? (
        <Text style={styles.productNone}>{t.discovery.noProductMatch}</Text>
      ) : (
        <>
          {hits.map((h) => (
            <Pressable
              key={h.id}
              onPress={() => onOpenShop(h.shopId)}
              style={({ pressed }) => [styles.productHit, pressed && { opacity: 0.7 }]}
            >
              <ImageOrInitial uri={h.imageUrl} name={h.name} style={styles.productHitThumb} />
              <View style={styles.flex}>
                <Text style={styles.productHitName} numberOfLines={1}>{h.name}</Text>
                <Text style={styles.productHitShop} numberOfLines={1}>
                  {h.shopName} · {formatDistance(h.distanceMeters)}
                  {!h.shopIsOpen ? ` · ${t.discovery.closed}` : ''}
                </Text>
                <View style={styles.productHitPriceRow}>
                  <Text style={styles.productHitPrice}>{formatRupees(h.pricePaise)}</Text>
                  {h.mrpPaise && h.mrpPaise > h.pricePaise ? (
                    <Text style={styles.productHitMrp}>{formatRupees(h.mrpPaise)}</Text>
                  ) : null}
                  {!h.inStock ? <Text style={styles.productHitOos}>{t.discovery.productOutOfStock}</Text> : null}
                </View>
              </View>
            </Pressable>
          ))}
          {hasMore ? (
            <Pressable
              onPress={onLoadMore}
              disabled={moreLoading}
              style={({ pressed }) => [styles.productMore, pressed && { opacity: 0.7 }]}
            >
              {moreLoading ? (
                <ActivityIndicator color={theme.color.primary} />
              ) : (
                <Text style={styles.productMoreText}>{t.discovery.showMoreProducts}</Text>
              )}
            </Pressable>
          ) : null}
        </>
      )}
      <Text style={styles.productShopsLabel}>{t.discovery.moreShopsLabel}</Text>
    </View>
  );
}

/**
 * useBannerRatio — measure the natural aspect ratio (height/width) of the
 * admin-uploaded banners so we can size the hero box to the image instead of a
 * hard-coded 2:1 crop. Uses the tallest banner's ratio (so no banner is cropped
 * in a shared-height carousel), clamped to a sane range. Defaults to 2:1 until
 * the first measurement lands.
 */
function useBannerRatio(banners: Banner[]): number {
  const key = banners.map((b) => b.imageUrl).join(',');
  const [ratio, setRatio] = useState(0.5); // height/width; 0.5 = 2:1 landscape
  useEffect(() => {
    if (banners.length === 0) return;
    let cancelled = false;
    let maxR = 0;
    let pending = banners.length;
    const done = () => {
      pending -= 1;
      if (pending === 0 && !cancelled && maxR > 0) {
        setRatio(Math.min(1.1, Math.max(0.3, maxR)));
      }
    };
    banners.forEach((b) => {
      Image.getSize(
        b.imageUrl,
        (w, h) => { if (w > 0) maxR = Math.max(maxR, h / w); done(); },
        () => done(),
      );
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ratio;
}

/**
 * BannerCarousel — full-width, auto-scrolling hero-image carousel (Zomato/Swiggy
 * style). Admin-uploaded landscape promo images for the customer's city.
 *
 * Loops seamlessly (…3 → 1 → 2 → 3 → 1…) by cloning the first/last slides at the
 * edges and jumping without animation when the user (or the timer) reaches a
 * clone. Auto-advances every ~4s; a manual swipe pauses the timer briefly so it
 * doesn't fight the user. Page dots track the real slide index.
 */
function BannerCarousel({ banners }: { banners: Banner[] }) {
  const ratio = useBannerRatio(banners); // natural height/width — show full banner, no crop
  const aspectRatio = ratio > 0 ? 1 / ratio : 2; // width/height for the box (2 = 2:1)
  // Measure the ACTUAL rendered width (onLayout) rather than Dimensions.window —
  // on web the window is the whole browser, wider than the app's content column,
  // which would make the image overflow and get clipped (the "cropped" bug).
  const [cardW, setCardW] = useState(0);
  const CARD_H = Math.round(cardW * ratio);
  const n = banners.length;
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0); // real slide index (0..n-1), for dots
  const pageRef = useRef(1); // position in the extended (cloned) list
  const pausedUntilRef = useRef(0);
  const tickRef = useRef(0);

  const scrollToPage = useCallback((page: number, animated: boolean) => {
    scrollRef.current?.scrollTo({ x: page * cardW, animated });
  }, [cardW]);

  // Start on the first real slide (offset by the leading clone).
  useEffect(() => {
    if (n <= 1 || cardW === 0) return;
    pageRef.current = 1;
    const id = setTimeout(() => scrollToPage(1, false), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, cardW]);

  // Auto-advance timer — advances one page every 4s unless recently paused.
  useEffect(() => {
    if (n <= 1 || cardW === 0) return;
    tickRef.current = 0;
    const timer = setInterval(() => {
      // Respect a short pause after a manual swipe (use a counter, not Date.now).
      if (pausedUntilRef.current > 0) { pausedUntilRef.current -= 1; return; }
      const next = pageRef.current + 1;
      pageRef.current = next;
      scrollToPage(next, true);
    }, 4000);
    return () => clearInterval(timer);
  }, [n, cardW, scrollToPage]);

  const onMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (cardW === 0) return;
    const page = Math.round(e.nativeEvent.contentOffset.x / cardW);
    pageRef.current = page;
    if (page === 0) {
      // Reached leading clone (of last) → jump to the real last slide.
      pageRef.current = n;
      scrollToPage(n, false);
      setIndex(n - 1);
    } else if (page === n + 1) {
      // Reached trailing clone (of first) → jump to the real first slide.
      pageRef.current = 1;
      scrollToPage(1, false);
      setIndex(0);
    } else {
      setIndex(page - 1);
    }
  }, [cardW, n, scrollToPage]);

  // Keep the page dots in sync WHILE scrolling (auto-advance uses a programmatic
  // scrollTo, whose momentum-end doesn't fire reliably on web — so without this
  // the dots lag behind the visible banner). Maps the extended-list page (with
  // its leading/trailing clones) back to the real 0..n-1 slide index.
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (cardW === 0) return;
    const page = Math.round(e.nativeEvent.contentOffset.x / cardW);
    const real = page <= 0 ? n - 1 : page >= n + 1 ? 0 : page - 1;
    setIndex((prev) => (prev === real ? prev : real));
  }, [cardW, n]);

  // Single banner → static, no loop/dots/timer. Full-width via '100%' +
  // aspectRatio so it fills the real column width and shows the whole image.
  if (n === 1) {
    return (
      <View style={styles.heroBannerWrap}>
        <Image
          source={{ uri: banners[0].imageUrl }}
          style={{ width: '100%', aspectRatio }}
          resizeMode="cover"
        />
      </View>
    );
  }

  // Extended list with clones: [lastClone, 0..n-1, firstClone].
  const slides = [banners[n - 1], ...banners, banners[0]];

  return (
    <View
      style={styles.heroBannerWrap}
      onLayout={(e) => setCardW(e.nativeEvent.layout.width)}
    >
      {cardW > 0 ? (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={() => { pausedUntilRef.current = 2; }}
          onMomentumScrollEnd={onMomentumEnd}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {slides.map((b, i) => (
            <Image
              key={`${b.id}-${i}`}
              source={{ uri: b.imageUrl }}
              style={{ width: cardW, height: CARD_H }}
              resizeMode="contain"
            />
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.bannerDots}>
        {banners.map((b, i) => (
          <View
            key={b.id}
            style={[styles.bannerDot, i === index && styles.bannerDotActive]}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * DiscoveryHeader — the non-search list header: a promo banner, an admin-curated
 * "Featured shops" horizontal strip (Premium; not a paid ad), and a
 * "Recommended for you" label above the ranked shop list.
 */
function DiscoveryHeader({
  promoText,
  banners,
  premiumShops,
  onOpenShop,
  t,
}: {
  promoText: string;
  banners: Banner[];
  premiumShops: NearbyShop[];
  onOpenShop: (shop: NearbyShop) => void;
  t: Strings;
}) {
  return (
    <View>
      {banners.length > 0 ? (
        <BannerCarousel banners={banners} />
      ) : null}

      {premiumShops.length > 0 ? (
        <View style={styles.featuredSection}>
          <Text style={styles.featuredTitle}>⭐ {t.discovery.featuredTitle}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.featuredRow}
          >
            {premiumShops.map((shop) => (
              <Pressable
                key={shop.id}
                onPress={() => onOpenShop(shop)}
                style={({ pressed }) => [styles.featuredCard, pressed && { opacity: 0.85 }]}
              >
                <ImageOrInitial
                  uri={bannerImage(shop.id, shop.bannerUrl ?? shop.storefrontPhotoUrl, 300, 160, shop.name)}
                  name={shop.name}
                  style={styles.featuredBanner}
                />
                <View style={styles.featuredBody}>
                  <Text style={styles.featuredName} numberOfLines={1}>{shop.name}</Text>
                  <Text style={styles.featuredMeta} numberOfLines={1}>
                    {shop.ratingCount > 0 ? `★ ${shop.avgRating.toFixed(1)}` : t.common.newBadge}
                    {shop.distanceMeters != null ? `  ·  ${formatDistance(shop.distanceMeters)}` : ''}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <Text style={styles.recommendedLabel}>{t.discovery.recommendedForYou}</Text>
    </View>
  );
}

function ShopListSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.card}>
          <SkeletonBlock width="100%" height={120} radius={0} />
          <View style={styles.cardBody}>
            <SkeletonBlock width="60%" height={18} />
            <SkeletonBlock width="40%" height={13} style={{ marginTop: theme.space.xs }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function ShopCard({ shop, busy, onPress }: { shop: NearbyShop; busy?: boolean; onPress: () => void }) {
  const { t } = useLang();
  const distance = formatDistance(shop.distanceMeters);
  const eta = formatEta(shop.distanceMeters);
  const contact = shop as NearbyShop & ShopContactFields;
  const metaParts = [eta, distance].filter(Boolean) as string[];
  const offerTitle = (shop as NearbyShop & { activeOffer?: { title?: string } | null }).activeOffer?.title ?? shop.offerText;

  // Which fulfilment options are available right now.
  const deliveryAvailable = contact.deliveryAvailable !== false; // default true when API omits it
  const pickupAvailable = contact.selfPickupEnabled !== false;

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.card, !shop.isOpen && styles.cardClosed, pressed && styles.pressed]}
    >
      {busy ? (
        <View style={styles.cardLoadingOverlay}>
          <ActivityIndicator color={theme.color.primary} />
        </View>
      ) : null}
      <View style={styles.bannerWrap}>
        <ImageOrInitial
          uri={bannerImage(shop.id, shop.bannerUrl ?? shop.storefrontPhotoUrl, 400, 200, shop.name)}
          name={shop.name}
          style={styles.banner}
        />
        <View style={styles.bannerOverlay} />
        <Badge
          label={shop.isOpen ? t.discovery.open : t.discovery.closed}
          tone={shop.isOpen ? 'success' : 'neutral'}
          style={styles.openBadge}
        />
        {shop.isSponsored ? (
          <View style={styles.sponsoredBadge}>
            <Text style={styles.sponsoredBadgeText}>{t.discovery.sponsored}</Text>
          </View>
        ) : null}
        {shop.ratingCount > 0 ? (
          <View style={styles.ratingPill}>
            <Text style={styles.ratingPillText}>★ {shop.avgRating.toFixed(1)}</Text>
          </View>
        ) : (
          <Badge label={t.common.newBadge} tone="accent" style={styles.ratingPillBadge} />
        )}
      </View>

      <View style={styles.cardBody}>
        <View style={styles.shopNameRow}>
          <ImageOrInitial
            uri={logoImage(shop.id, shop.logoUrl, 96, shop.name)}
            name={shop.name}
            rounded
            style={styles.shopLogo}
          />
          <Text style={styles.shopName} numberOfLines={1}>{shop.name}</Text>
          <View style={styles.shopNameChips}>
            {deliveryAvailable && <Text style={styles.shopNameChip}>{t.discovery.optionDelivery}</Text>}
            {pickupAvailable && <Text style={styles.shopNameChip}>{t.discovery.optionPickup}</Text>}
          </View>
        </View>

        <Text style={styles.metaLine} numberOfLines={1}>
          {metaParts.join('  ·  ')}
        </Text>

        {!deliveryAvailable && pickupAvailable ? (
          <Text style={styles.optionNote}>{t.discovery.pickupOnlyNote}</Text>
        ) : null}

        {offerTitle ? (
          <View style={styles.offerRibbon}>
            <Text style={styles.offerText} numberOfLines={1}>{offerTitle}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * Build a friendly "Area, City" label from a Nominatim address object. Picks the
 * most specific locality (suburb / neighbourhood / …) plus a city-level name,
 * de-duplicating when they coincide. Returns null if nothing usable is present.
 */
function buildPlaceName(address?: Record<string, string>): string | null {
  if (!address) return null;
  const area =
    address.suburb ||
    address.neighbourhood ||
    address.village ||
    address.town ||
    address.city_district ||
    address.locality;
  const city =
    address.city || address.town || address.state_district || address.county || address.state;
  const parts: string[] = [];
  if (area) parts.push(area);
  if (city && city !== area) parts.push(city);
  const label = parts.join(', ');
  return label || city || area || null;
}

/**
 * Extract the city-level name from a Nominatim address object, used to check
 * serviceability. Prefers the specific city, then town, then state district.
 * Returns null when nothing usable is present (treated as "unknown").
 */
function buildCityName(address?: Record<string, string>): string | null {
  if (!address) return null;
  return address.city || address.town || address.state_district || null;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  flex: { flex: 1 },
  pressed: { opacity: 0.9 },

  header: {
    backgroundColor: theme.color.bg,
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.md,
    gap: theme.space.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
  mapToggleBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.color.surfaceAlt, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  mapToggleBtnActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  mapToggleIcon: { fontSize: 16 },
  mapToggleIconActive: { fontSize: 16 },
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    overflow: 'hidden',
    marginTop: 2,
  },
  viewToggleSeg: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewToggleSegActive: {
    backgroundColor: theme.color.primary,
  },
  viewToggleSegText: { fontSize: 15, color: theme.color.textMuted },
  viewToggleSegTextActive: { color: '#fff' },
  logoMini: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: theme.color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  logoMiniText: { fontSize: 20, fontWeight: "800", color: theme.color.onPrimary },
  deliverLabel: { fontSize: theme.font.tiny, color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationPin: { fontSize: 14 },
  locationValue: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  locationGpsHint: { fontSize: theme.font.tiny, color: theme.color.primary, fontWeight: '600' },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  searchIcon: { fontSize: theme.font.body },
  searchInput: { flex: 1, fontSize: theme.font.body, color: theme.color.text },
  searchClear: { fontSize: theme.font.body, color: theme.color.textMuted, fontWeight: "700" },

  chipsWrap: { backgroundColor: theme.color.bg, paddingBottom: theme.space.xs },
  chipsRow: { paddingHorizontal: theme.space.lg, gap: 6, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { backgroundColor: theme.color.primaryLight, borderColor: theme.color.primary },
  chipText: { fontSize: 12.5, fontWeight: "600", color: theme.color.textMuted },
  chipTextActive: { color: theme.color.primaryDark },

  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.bg,
    paddingRight: theme.space.lg,
    paddingVertical: theme.space.xs,
    gap: theme.space.sm,
  },
  chipsScroll: { flex: 1 },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
  },
  resultCount: { fontSize: theme.font.small, color: theme.color.textMuted, fontWeight: "500" },
  filterActions: { flexDirection: 'row', gap: 6, flexShrink: 0, alignItems: 'center' },
  filterDivider: { width: 1, height: 22, backgroundColor: theme.color.border, marginHorizontal: 2 },
  filterPill: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.bg,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  filterPillActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  filterPillText: { fontSize: 12.5, fontWeight: "600", color: theme.color.text },
  filterPillTextActive: { color: theme.color.onPrimary },

  list: { padding: theme.space.md, paddingBottom: theme.space.xxl, gap: theme.space.md },
  gridRow: { gap: theme.space.md, paddingHorizontal: theme.space.md, marginBottom: theme.space.md },

  // Cross-shop product-search results section (list header when searching)
  productSection: { gap: theme.space.sm, marginBottom: theme.space.sm },
  productSectionTitle: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  productNone: { fontSize: theme.font.small, color: theme.color.textFaint, paddingVertical: theme.space.sm },
  productHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    backgroundColor: theme.color.surface,
    borderRadius: 14,
    padding: theme.space.sm,
    borderWidth: 1,
    borderColor: theme.color.border,
    ...shadow.sm,
  },
  productHitThumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: theme.color.surfaceAlt },
  productHitName: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  productHitShop: { fontSize: theme.font.tiny, color: theme.color.textMuted, marginTop: 1 },
  productHitPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: theme.space.sm, marginTop: 2 },
  productHitPrice: { fontSize: theme.font.body, fontWeight: '800', color: theme.color.text },
  productHitMrp: { fontSize: theme.font.small, color: theme.color.textFaint, textDecorationLine: 'line-through' },
  productHitOos: { fontSize: theme.font.tiny, color: theme.color.danger, fontWeight: '700' },
  productMore: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.space.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.color.primary,
    minHeight: 40,
  },
  productMoreText: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.primary },
  productShopsLabel: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: theme.space.sm },

  // Grid card (2-column Instacart-style)
  gridCard: {
    flex: 1,
    backgroundColor: theme.color.surface,
    borderRadius: 16,
    overflow: 'hidden',
    ...shadow.sm,
  },
  gridBannerWrap: { position: 'relative' },
  gridBanner: { width: '100%', height: 140, backgroundColor: theme.color.surfaceAlt },
  closedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closedOverlayText: { color: '#fff', fontWeight: '800', fontSize: theme.font.small, letterSpacing: 0.5 },
  gridRatingPill: {
    position: 'absolute',
    top: 8, right: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: theme.radius.pill,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  gridRatingText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  gridOfferBadge: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(11,122,75,0.88)',
    paddingHorizontal: 8, paddingVertical: 4,
  },
  gridOfferText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  gridCardBody: { padding: theme.space.sm, gap: 3 },
  gridShopName: { fontSize: theme.font.body, fontWeight: '800', color: theme.color.text },
  gridEta: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.primary },
  gridMeta: { fontSize: theme.font.tiny, color: theme.color.textMuted },

  card: {
    backgroundColor: theme.color.card,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    ...shadow.md,
  },
  cardClosed: { opacity: 0.6 },
  cardLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    borderRadius: theme.radius.lg,
  },
  bannerWrap: { position: 'relative' },
  banner: { width: '100%', height: 180, backgroundColor: theme.color.surfaceAlt },
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  openBadge: { position: 'absolute', top: theme.space.sm, right: theme.space.sm },
  ratingPill: {
    position: 'absolute',
    bottom: theme.space.sm,
    right: theme.space.sm,
    backgroundColor: theme.color.card,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.sm,
    paddingVertical: 3,
    ...shadow.sm,
  },
  ratingPillText: { fontSize: theme.font.small, fontWeight: "800", color: theme.color.success },
  ratingPillBadge: { position: 'absolute', bottom: theme.space.sm, right: theme.space.sm },

  cardBody: { padding: theme.space.lg, gap: theme.space.xs },
  shopNameRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  shopLogo: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.color.surfaceAlt },
  shopName: { flex: 1, fontSize: theme.font.h2, fontWeight: "800", color: theme.color.text },
  shopNameChips: { flexDirection: 'row', gap: 4, flexShrink: 0 },
  shopNameChip: { fontSize: 10, fontWeight: '700', color: theme.color.primary, backgroundColor: '#EFF6FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  metaLine: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  optionRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  optionChip: {
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  optionChipText: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.text },
  optionNote: { fontSize: theme.font.tiny, color: theme.color.warning, fontWeight: '600' },
  addressLine: { fontSize: theme.font.small, color: theme.color.textMuted },
  offerRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.accentLight,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
    marginTop: theme.space.xs,
  },
  offerText: { fontSize: theme.font.small, fontWeight: "700", color: theme.color.warning },
  minOrderNote: { fontSize: theme.font.tiny, color: theme.color.textFaint, marginTop: 2 },

  // Sponsored ("AD") badge — top-left of a sponsored shop's banner.
  sponsoredBadge: {
    position: 'absolute',
    top: theme.space.sm,
    left: theme.space.sm,
    backgroundColor: 'rgba(17,24,39,0.82)',
    borderRadius: theme.radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sponsoredBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  // Promo banner (top of the non-search list header).
  promoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    backgroundColor: theme.color.primaryLight,
    borderRadius: theme.radius.lg,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.lg,
    marginBottom: theme.space.md,
  },
  promoEmoji: { fontSize: 22 },
  promoText: { flex: 1, fontSize: theme.font.small, fontWeight: '700', color: theme.color.primaryDark },

  // Home banner carousel (admin-uploaded hero images).
  heroBannerWrap: { marginHorizontal: -theme.space.md, marginBottom: theme.space.md },
  bannerDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: theme.space.sm,
  },
  bannerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.color.border,
  },
  bannerDotActive: {
    width: 18,
    backgroundColor: theme.color.primary,
  },

  // Featured (Premium) horizontal strip.
  featuredSection: { marginBottom: theme.space.lg },
  featuredTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text, marginBottom: theme.space.sm },
  featuredRow: { gap: theme.space.md, paddingRight: theme.space.md },
  featuredCard: {
    width: 160,
    backgroundColor: theme.color.card,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    ...shadow.sm,
  },
  featuredBanner: { width: '100%', height: 90, backgroundColor: theme.color.surfaceAlt },
  featuredBody: { padding: theme.space.sm, gap: 2 },
  featuredName: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.text },
  featuredMeta: { fontSize: theme.font.tiny, color: theme.color.textMuted },

  recommendedLabel: {
    fontSize: theme.font.h3,
    fontWeight: '800',
    color: theme.color.text,
    marginBottom: theme.space.sm,
  },

  // Sticky cart bar (floats above the tab bar when the cart has items).
  cartBar: {
    position: 'absolute',
    left: theme.space.md,
    right: theme.space.md,
    bottom: theme.space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius.lg,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.lg,
    ...shadow.lg,
  },
  cartBarLeft: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, flex: 1 },
  cartBarCountPill: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBarCountText: { color: '#fff', fontWeight: '800', fontSize: theme.font.small },
  cartBarShop: { color: 'rgba(255,255,255,0.85)', fontSize: theme.font.tiny, fontWeight: '600' },
  cartBarSummary: { color: '#fff', fontSize: theme.font.small, fontWeight: '800' },
  cartBarCta: { color: '#fff', fontSize: theme.font.body, fontWeight: '800' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl, gap: theme.space.sm },
  emptyTitle: { fontSize: theme.font.h3, fontWeight: "700", color: theme.color.text },
  emptySub: { fontSize: theme.font.body, color: theme.color.textMuted, textAlign: 'center' },
  notifiedText: {
    fontSize: theme.font.body,
    fontWeight: "600",
    color: theme.color.primary,
    textAlign: 'center',
  },

  // Map/List toggle
  viewToggleRow: {
    flexDirection: 'row',
    marginHorizontal: theme.space.lg,
    marginBottom: theme.space.sm,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.pill,
    padding: 3,
  },
  viewToggleBtn: { flex: 1, paddingVertical: theme.space.sm, borderRadius: theme.radius.pill, alignItems: 'center' },
  viewToggleBtnActive: { backgroundColor: theme.color.primary, ...shadow.sm },
  viewToggleText: { fontSize: theme.font.small, fontWeight: "600", color: theme.color.textMuted },
  viewToggleTextActive: { color: '#fff', fontWeight: "700" },

  // Map view
  mapWrap: { flex: 1, position: 'relative', minHeight: 400 },
  mapSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: theme.color.bg,
    borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl,
    padding: theme.space.lg, gap: theme.space.sm,
    ...shadow.lg,
  },
  mapSheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: theme.color.border, alignSelf: 'center', marginBottom: theme.space.xs },
  mapSheetContent: { flexDirection: 'row', gap: theme.space.md, alignItems: 'center' },
  mapSheetThumbWrap: { position: 'relative', width: 56, height: 56 },
  mapSheetThumb: { width: 56, height: 56, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt },
  mapSheetLogo: { position: 'absolute', bottom: -8, right: -8, width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#fff', backgroundColor: theme.color.surfaceAlt },
  mapSheetName: { fontSize: theme.font.h3, fontWeight: "700", color: theme.color.text },
  mapSheetMeta: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  mapSheetRow: { flexDirection: 'row', gap: theme.space.sm, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' },
  mapOfferTag: { fontSize: theme.font.tiny, color: theme.color.warning, fontWeight: "700" },
  mapSheetDist: { fontSize: theme.font.tiny, color: theme.color.textFaint },
  mapSheetCta: { fontSize: theme.font.small, fontWeight: "700", color: theme.color.primary, textAlign: 'center', paddingTop: theme.space.xs },
  mapSheetClose: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.color.surfaceAlt, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  mapSheetCloseText: { fontSize: 12, color: theme.color.textMuted, fontWeight: "700" },
  mapSheetBtns: { flexDirection: 'row', gap: theme.space.md, marginTop: theme.space.sm },
  mapBtnSecondary: {
    flex: 1, paddingVertical: 13, borderRadius: theme.radius.pill,
    borderWidth: 1.5, borderColor: theme.color.primary,
    alignItems: 'center',
  },
  mapBtnSecondaryText: { color: theme.color.primary, fontWeight: "700", fontSize: theme.font.small },
  mapBtnPrimary: {
    flex: 1, paddingVertical: 13, borderRadius: theme.radius.pill,
    backgroundColor: theme.color.primary, alignItems: 'center',
  },
  mapBtnPrimaryText: { color: '#fff', fontWeight: "700", fontSize: theme.font.small },
  mapBtnDisabled: { backgroundColor: theme.color.surfaceAlt },
  mapBtnDisabledText: { color: theme.color.textMuted, fontWeight: "600", fontSize: theme.font.small },

  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },
  confirmCard: { width: '100%', maxWidth: 360, backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, padding: theme.space.xl, gap: theme.space.md },
  confirmTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  confirmBody: { fontSize: theme.font.body, color: theme.color.textMuted, lineHeight: 21 },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.space.sm, marginTop: theme.space.xs },
  confirmCancel: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, borderRadius: theme.radius.md },
  confirmCancelText: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.textMuted },
  confirmContinue: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, borderRadius: theme.radius.md, backgroundColor: theme.color.primary },
  confirmContinueText: { fontSize: theme.font.small, fontWeight: '700', color: '#fff' },

  // Saved address picker sheet
  addrPickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  addrPickerSheet: { backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: theme.space.lg, paddingBottom: 32, gap: theme.space.sm },
  addrPickerHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: theme.color.border, alignSelf: 'center', marginBottom: theme.space.sm },
  addrPickerTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text, marginBottom: theme.space.xs },
  addrPickerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingVertical: theme.space.md, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  addrPickerGps: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingVertical: theme.space.md },
  addrPickerIcon: { fontSize: 20, width: 28, textAlign: 'center' },
  addrPickerLabel: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  addrPickerLine: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
});
