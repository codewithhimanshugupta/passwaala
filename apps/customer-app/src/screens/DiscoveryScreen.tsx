import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NearbyShop } from '@passwaala/api-client';
import { api } from '../api';
import { prefetchCheckout, getPrefetchedCheckout } from '../checkoutPrefetch';
import type { ShopContactFields, Address } from '../types';
import { bannerImage, logoImage, formatDistance, formatEta, formatRupees, shadow, theme } from '../theme';
import { Badge, Button, EmptyState, ErrorState, SkeletonBlock } from '../ui';
import { ImageOrInitial } from '../ImageOrInitial';
import { ChevronDown } from '../ChevronDown';
import { useLang } from '../i18n/LanguageContext';
import type { Strings } from '../i18n/strings';

/** Nearby shops fetched per page in list view — 5 at a time for fast first load. */
const PAGE_SIZE = 5;

/** Module-level shop cache — survives tab switches and back navigation.
 *  Shops are shown instantly from cache; a background refresh updates silently. */
let _cachedShops: NearbyShop[] = [];
let _cacheKey = ''; // lat:lng:sort:category:openNow
let _nextPagePrefetched: NearbyShop[] = []; // next page ready before user scrolls

function makeCacheKey(lat: number, lng: number, sort: string, category: string, openNow: boolean) {
  return `${lat.toFixed(3)}:${lng.toFixed(3)}:${sort}:${category}:${openNow}`;
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
}) {
  const { t } = useLang();
  const CATEGORIES = categoriesFor(t);
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
  const [searchQuery, setSearchQuery] = useState('');
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

  // Cities PassWaala currently operates in (enabled city names), loaded once on
  // mount. Null while loading / on failure — we then treat the city as unknown
  // and never show the "not available" state (fail open).
  const [serviceableCities, setServiceableCities] = useState<string[] | null>(null);

  // "Notify me" acknowledgement for the not-available empty state.
  const [notified, setNotified] = useState(false);

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
    const geo =
      typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : null;
    if (!geo) {
      // Geolocation unavailable — mark tried; user can pick a saved address.
      onLocChange({ ...loc, gpsTried: true });
      return;
    }
    setLocating(true);
    geo.getCurrentPosition(
      (pos) => {
        onLocChange({
          coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          placeName: null, // reverse-geocode effect fills this
          addressPicked: false,
          gpsTried: true,
        });
        setLocating(false);
      },
      () => {
        // Denied / timeout — do NOT silently jump to Jhansi. Just mark tried;
        // the UI shows a "set location" prompt and the user can pick an address.
        onLocChange({ ...loc, gpsTried: true });
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
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
        }
      } catch {
        if (!cancelled) setServiceableCities(null);
      }
    })();
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
        limit: isMap ? 50 : PAGE_SIZE,
        offset: 0,
      });
      setShops(result);
      setCanLoadMore(!isMap && result.length === PAGE_SIZE);
      // Write to module-level cache for instant display on next back-navigation
      if (!isMap) {
        _cachedShops = result;
        _cacheKey = makeCacheKey(coords.lat, coords.lng, sort, category ?? '', openNow);
      }
      if (restoredShopId) {
        const restored = result.find(s => s.id === restoredShopId);
        if (restored) setSelectedShop(restored);
      }
      // Prefetch next page silently so load-more is instant
      if (!isMap && result.length === PAGE_SIZE) {
        void api.nearbyShops({
          lat: coords.lat, lng: coords.lng,
          radiusMeters: Math.round(radiusOverride ?? cityRadius),
          sort, openNow: openNow || undefined, category: category || undefined,
          limit: PAGE_SIZE, offset: PAGE_SIZE,
        }).then(next => { _nextPagePrefetched = next; }).catch(() => undefined);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [category, sort, openNow, coords, viewMode, mapRadius, cityRadius, restoredShopId]);

  // Load the next page — uses prefetched data when available for instant append.
  const loadMore = useCallback(async () => {
    if (loadingMore || !canLoadMore || viewMode === 'map' || !coords) return;
    setLoadingMore(true);
    try {
      // Use prefetched next page if available (avoids a network wait)
      let next: NearbyShop[];
      if (_nextPagePrefetched.length > 0) {
        next = _nextPagePrefetched;
        _nextPagePrefetched = [];
      } else {
        next = await api.nearbyShops({
          lat: coords.lat, lng: coords.lng,
          radiusMeters: Math.round(cityRadius),
          sort, openNow: openNow || undefined, category: category || undefined,
          limit: PAGE_SIZE, offset: shops.length,
        });
      }
      setShops((prev) => {
        const updated = [...prev, ...next];
        _cachedShops = updated;
        return updated;
      });
      setCanLoadMore(next.length === PAGE_SIZE);
      // Pre-fetch the page after this one silently
      const nextOffset = shops.length + next.length;
      if (next.length === PAGE_SIZE) {
        void api.nearbyShops({
          lat: coords.lat, lng: coords.lng,
          radiusMeters: Math.round(cityRadius),
          sort, openNow: openNow || undefined, category: category || undefined,
          limit: PAGE_SIZE, offset: nextOffset,
        }).then(prefetched => { _nextPagePrefetched = prefetched; }).catch(() => undefined);
      }
    } catch {
      /* keep what's loaded */
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, canLoadMore, viewMode, coords, cityRadius, sort, openNow, category, shops.length]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

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
            <Text style={styles.logoMiniText}>प</Text>
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

      {/* Category chips */}
      <View style={styles.chipsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {CATEGORIES.map((c) => {
            const active = c.slug === category;
            return (
              <Pressable
                key={c.slug || 'all'}
                onPress={() => setCategory(c.slug)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Filter row */}
      <View style={styles.filterRow}>
        <Text style={styles.resultCount}>
          {t.discovery.shopsNearby(shops.length)}
        </Text>
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
                onPress={() => setNotified(true)}
              />
            )
          }
        />
      ) : shops.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t.discovery.noMatchTitle}</Text>
          <Text style={styles.emptySub}>{t.discovery.noMatchSubtitle}</Text>
        </View>
      ) : viewMode === 'map' && Platform.OS === 'web' ? (
        <View style={styles.mapWrap}>
          <ShopsMap
            shops={shops.filter((s) => !searchQuery.trim() || s.name.toLowerCase().includes(searchQuery.toLowerCase()))}
            center={coords ?? { lat: 0, lng: 0 }}
            selected={selectedShop}
            onSelect={setSelectedShop}
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
                  if (lat && lng) { const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`; if (typeof window !== 'undefined') window.open(url, '_blank'); }
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
    </View>
  );
}

function ShopsMap({ shops, center, selected, onSelect, onRadiusChange }: {
  shops: NearbyShop[];
  center: { lat: number; lng: number };
  selected: NearbyShop | null;
  onSelect: (shop: NearbyShop | null) => void;
  onRadiusChange?: (radius: number) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const docRef = useRef<string>('');

  // Build a self-contained Leaflet doc with all shop pins.
  // latitude/longitude now come directly from the nearby API response.
  const shopsJson = JSON.stringify(shops.map(s => {
    const sc = s as NearbyShop & ShopContactFields;
    const lat = sc.latitude != null ? Number(sc.latitude) : null;
    const lng = sc.longitude != null ? Number(sc.longitude) : null;
    // Prefer logoUrl (branding icon) then storefrontPhotoUrl for map pins.
    // Skip any URL pointing at the seed /storefront.jpg placeholder that doesn't exist.
    const isUsable = (url?: string | null) =>
      !!url &&
      url.startsWith('http') &&
      !url.includes('/storefront.jpg') &&
      !url.includes('picsum.photos');
    const photo = isUsable(s.logoUrl) ? s.logoUrl! : isUsable(s.storefrontPhotoUrl) ? s.storefrontPhotoUrl : null;
    return { id: s.id, name: s.name, lat, lng, isOpen: s.isOpen, photo };
  }).filter(s => s.lat && s.lng));

  // Memoize the full doc so the iframe never reloads on unrelated re-renders.
  // It only rebuilds when shops or center coords actually change.
  const doc = useRef('');
  const prevKey = useRef('');
  const key = shopsJson + center.lat + center.lng;
  if (prevKey.current !== key) {
    prevKey.current = key;
    doc.current = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
html,body,#map{height:100%;margin:0;padding:0}
.pin-wrap{width:44px;height:44px;border-radius:50%;border:3px solid #0B7A4B;overflow:hidden;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center}
.pin-wrap.active{border-color:#0B7A4B;box-shadow:0 0 0 4px rgba(11,122,75,0.25)}
.pin-wrap.closed{border-color:#999;opacity:0.7}
.pin-img{width:100%;height:100%;object-fit:cover}
.pin-emoji{font-size:22px;line-height:1}
.user-dot{width:18px;height:18px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 3px rgba(37,99,235,0.3)}
</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var shops=${shopsJson};
var map=L.map('map',{zoomControl:true,attributionControl:false});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
L.marker([${center.lat},${center.lng}],{icon:L.divIcon({html:'<div class="user-dot"></div>',className:'',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(map);
function makeIcon(s,active){
  var inner=s.photo?'<img class="pin-img" src="'+s.photo+'" onerror="this.style.display=\\'none\\';this.parentNode.innerHTML=\\'<span class=pin-emoji></span>\\'"/>':'<span class="pin-emoji"></span>';
  var cls='pin-wrap'+(active?' active':'')+(s.isOpen?'':' closed');
  return L.divIcon({html:'<div class="'+cls+'">'+inner+'</div>',className:'',iconSize:[44,44],iconAnchor:[22,22]});
}
var markers={};
shops.forEach(function(s){
  if(!s.lat||!s.lng)return;
  var m=L.marker([s.lat,s.lng],{icon:makeIcon(s,false)}).addTo(map);
  m.on('click',function(){window.parent.postMessage({type:'shopClick',id:s.id},'*');});
  markers[s.id]=m;
});
var allLats=[${center.lat}].concat(shops.filter(function(s){return s.lat;}).map(function(s){return s.lat;}));
var allLngs=[${center.lng}].concat(shops.filter(function(s){return s.lng;}).map(function(s){return s.lng;}));
if(allLats.length>1){map.fitBounds([[Math.min.apply(null,allLats),Math.min.apply(null,allLngs)],[Math.max.apply(null,allLats),Math.max.apply(null,allLngs)]],{padding:[48,48],maxZoom:15});}
else{map.setView([${center.lat},${center.lng}],14);}
window.addEventListener('message',function(ev){
  var m=ev.data;
  if(m&&m.type==='selectShop'){Object.keys(markers).forEach(function(id){var s=shops.find(function(x){return x.id===id;});if(s)markers[id].setIcon(makeIcon(s,id===m.id));});}
});
window.parent.postMessage({type:'map-ready'},'*');
// Send current visible radius on every zoom/pan so the app can load more shops.
function sendRadius(){
  var b=map.getBounds();
  var c=map.getCenter();
  var ne=b.getNorthEast();
  var sw=b.getSouthWest();
  // Haversine distance from center to corner (approx radius of visible area).
  var R=6371000;
  var dLat=(ne.lat-sw.lat)*Math.PI/180;
  var dLng=(ne.lng-sw.lng)*Math.PI/180;
  var a=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(sw.lat*Math.PI/180)*Math.cos(ne.lat*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
  var radius=Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))/2);
  window.parent.postMessage({type:'radiusChanged',radius:radius},'*');
}
map.on('zoomend moveend',sendRadius);
</script></body></html>`;
  }

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const m = ev.data as { type: string; id?: string; radius?: number };
      if (m.type === 'map-ready') readyRef.current = true;
      if (m.type === 'shopClick' && m.id) {
        const shop = shops.find(s => s.id === m.id);
        onSelect(shop ?? null);
        iframeRef.current?.contentWindow?.postMessage({ type: 'selectShop', id: m.id }, '*');
      }
      if (m.type === 'radiusChanged' && m.radius && m.radius > 0) {
        onRadiusChange?.(m.radius);
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [shops, onSelect, onRadiusChange]);

  useEffect(() => {
    if (selected && readyRef.current) {
      iframeRef.current?.contentWindow?.postMessage({ type: 'selectShop', id: selected.id }, '*');
    }
  }, [selected]);

  const Iframe = 'iframe' as unknown as React.ComponentType<Record<string, unknown>>;
  return (
    <Iframe
      ref={iframeRef}
      srcDoc={doc.current}
      title="Nearby shops map"
      style={{ border: '0', width: '100%', height: 'calc(100dvh - 220px)', minHeight: '380px', display: 'block' }}
    />
  );
}

/** Placeholder shop-card list shown while the first page of shops loads. */
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
  chipsRow: { paddingHorizontal: theme.space.lg, gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { backgroundColor: theme.color.primaryLight, borderColor: theme.color.primary },
  chipText: { fontSize: 11, fontWeight: "600", color: theme.color.textMuted },
  chipTextActive: { color: theme.color.primaryDark },

  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
  },
  resultCount: { fontSize: theme.font.small, color: theme.color.textMuted, fontWeight: "500" },
  filterActions: { flexDirection: 'row', gap: theme.space.sm },
  filterPill: {
    paddingHorizontal: theme.space.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.bg,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  filterPillActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  filterPillText: { fontSize: theme.font.small, fontWeight: "600", color: theme.color.text },
  filterPillTextActive: { color: theme.color.onPrimary },

  list: { padding: theme.space.md, paddingBottom: theme.space.xxl, gap: theme.space.md },
  gridRow: { gap: theme.space.md, paddingHorizontal: theme.space.md, marginBottom: theme.space.md },

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
