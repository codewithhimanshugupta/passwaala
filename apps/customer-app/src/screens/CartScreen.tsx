import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PaymentMethod, DeliveryMode, OfferType, computeBill, platformDeliveryFeePaise } from '@nearbaz/shared';
import type { PlaceOrderResult } from '@nearbaz/shared';
import { friendlyMessage } from '@nearbaz/api-client';
import { api } from '../api';
import { clearCart, decOne, addOne, useCart, resetCartStore, reconcileWithCatalog } from '../cart';
import type { Address, ShopView } from '../types';
import { AddressForm } from '../components/AddressForm';
import { CouponScreen, type AppliedCoupon } from './CouponScreen';
import { estimateOrderMinutes, formatDistance, formatMinutesBand, formatRupees, haversineMeters, productImage, shadow, theme } from '../theme';
import { EditIcon } from '../EditDeleteIcons';
import { Badge, Button, CoinChip, Divider, EmptyState, Loading } from '../ui';
import { ImageOrInitial } from '../ImageOrInitial';
import { getPrefetchedCheckout, clearCheckoutPrefetch } from '../checkoutPrefetch';
import { StripedProgressBar } from '../StripedProgressBar';
import { useLang } from '../i18n/LanguageContext';
import { useBulkCart, bulkCartAddOne, currentBulkCartShops } from '../bulkCart';
import { getCurrentCoords } from '../geo';
import { idbGet } from '../idbKv';

/** Key of the active "Delivering to" location persisted at the app root (App.tsx). */
const LOC_STORAGE_KEY = 'pw.deliveryLoc.v1';

/** Synchronous read of the active delivery-location coords from the localStorage
 * mirror — so the cart can pick the nearest saved address to where the user is
 * actually ordering ("Delivering to …"), not fall back to the first address
 * while GPS is still resolving. */
function readDeliveryGeoSync(): { lat: number; lng: number } | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(LOC_STORAGE_KEY);
      if (raw) {
        const loc = JSON.parse(raw) as { coords?: { lat: number; lng: number } | null };
        if (loc?.coords && Number.isFinite(loc.coords.lat) && Number.isFinite(loc.coords.lng)) return loc.coords;
      }
    }
  } catch { /* ignore — fall back to GPS */ }
  return null;
}

/**
 * CartScreen — cart review + checkout (plan → Cart & Checkout). Line items with
 * +/- and remove, the SIGNATURE itemized bill breakdown (subtotal + delivery +
 * flat ₹10 platform fee with free-delivery note), min-order gating, clear cart,
 * saved-address selection + add form, payment picker, and place order with a
 * per-attempt idempotency key.
 */
// Module-level cache — survives CartScreen remounts (e.g. back from BulkCartScreen)
let _nearbyShopsCache: Array<{ id: string; name: string; city: string; latitude: number; longitude: number; distanceMeters: number }> = [];
let _nearbyShopIdCache: string | null = null;
let _shopDataCache: import('../types').ShopView | null = null;
let _shopDataShopId: string | null = null;

export function CartScreen({
  onBack,
  onBrowse,
  onOpenShop,
  onPlaced,
  onOpenBulkCart,
}: {
  onBack: () => void;
  onBrowse: () => void;
  onOpenShop: (shopId: string) => void;
  onPlaced: (result: PlaceOrderResult) => void;
  onOpenBulkCart?: () => void;
}) {
  const { t } = useLang();
  const localCart = useCart();
  const itemCount = localCart.itemCount;
  const shopId = localCart.shopId;
  // The shop's fee/offer/coords config — fetched ONCE from api.shop(). Items and
  // subtotal come from the LOCAL cart; the bill is computed entirely on-device
  // (see computedBill below) with NO server sync until the order is placed.
  const [shopData, setShopData] = useState<ShopView | null>(() =>
    _shopDataShopId === (localCart.shopId ?? null) ? _shopDataCache : null
  );
  // riderAvailable: false when no rider is online near the shop. Fetched from the
  // lightweight delivery-availability endpoint (not a cart sync).
  const [riderAvailableFromCart, setRiderAvailableFromCart] = useState(true);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>(PaymentMethod.UPI_DIRECT);
  const [fulfilment, setFulfilment] = useState<DeliveryMode>(DeliveryMode.SELF_DELIVERY);
  const [notes, setNotes] = useState('');
  const [loadingAddrs, setLoadingAddrs] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [placingStep, setPlacingStep] = useState(0);
  const [placingCancelHandle, setPlacingCancelHandle] = useState<{ cancel: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stable idempotency key for placement — generated once and reused across
  // retries so a transient/timed-out placement that actually succeeded is
  // de-duplicated instead of creating a duplicate order. Cleared on success.
  const idempotencyRef = useRef<string | null>(null);
  const [showAddrForm, setShowAddrForm] = useState(false);
  // Modal to switch between saved addresses (the cart shows only one at a time).
  const [showAddrPicker, setShowAddrPicker] = useState(false);
  const [coinBalance, setCoinBalance] = useState(0);
  const [pendingCancelFeePaise, setPendingCancelFeePaise] = useState(0);
  const [useCoins, setUseCoins] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  // A coupon applied at checkout (shop-funded OR NearBaz-funded). Mutually
  // exclusive with an offer — applying one clears the other (server enforces too).
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const [showCoupons, setShowCoupons] = useState(false);
  // Customer's current GPS position (best-effort) for the soft "far from your
  // current location" warning. Null until/if geolocation resolves.
  const [currentGeo, setCurrentGeo] = useState<{ lat: number; lng: number } | null>(null);
  // The active "Delivering to" location (root-persisted). Preferred over raw GPS
  // when choosing the default saved address, so the cart matches where the user
  // is ordering to. Seeded synchronously from the localStorage mirror.
  const [deliveryGeo, setDeliveryGeo] = useState<{ lat: number; lng: number } | null>(() => readDeliveryGeoSync());
  const [geoResolved, setGeoResolved] = useState(false);
  // The user has acknowledged the "far from your location" warning and wants to
  // proceed anyway. Reset whenever they switch to a different address.
  const [farConfirmed, setFarConfirmed] = useState(false);
  // Once the user has manually chosen an address, stop auto-selecting the nearest.
  // The "far from your location" popup ONLY activates after a manual pick — the
  // address the user arrived with (pre-selected on home) must never trigger it.
  const [addressPickedManually, setAddressPickedManually] = useState(false);

  // Shop coords (for the delivery-time estimate + distance-tiered fee), derived
  // from the fetched shop config.
  const shopGeo = (() => {
    if (!shopData) return null;
    const lat = shopData.latitude != null ? Number(shopData.latitude) : NaN;
    const lng = shopData.longitude != null ? Number(shopData.longitude) : NaN;
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  })();
  // Whether this shop delivers via NearBaz riders (distance-tiered fee) vs
  // self-delivery (flat shop fee).
  const platformDelivery = shopData?.platformDeliveryEnabled === true;

  const loadAddresses = useCallback(async () => {
    // Use the prefetched addresses (warmed on the shop screen) if fresh — the
    // list then shows instantly with no spinner. Otherwise fetch normally.
    const pre = getPrefetchedCheckout();
    if (pre) {
      setAddresses(pre.addresses);
      setLoadingAddrs(false);
      if (pre.addresses.length === 0) setShowAddrForm(true);
      return;
    }
    setLoadingAddrs(true);
    try {
      const list = (await api.addresses()) as Address[];
      setAddresses(list);
      // Selection is resolved by the nearest-address effect (prefers the address
      // closest to the customer's current location). Only open the add form when
      // there are no saved addresses at all.
      if (list.length === 0) setShowAddrForm(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingAddrs(false);
    }
  }, []);

  useEffect(() => {
    void loadAddresses();
    const pre = getPrefetchedCheckout();
    if (pre) {
      // Prefetch warm — use immediately, no network calls needed
      setCoinBalance(pre.coinBalance);
      setPendingCancelFeePaise(pre.pendingCancelFeePaise);
    } else {
      // Background fetch — non-blocking, UI renders with defaults
      void Promise.all([
        api.referralMe().then((r) => setCoinBalance(r?.coinBalance ?? 0)),
        api.me().then((a: any) => setPendingCancelFeePaise(a?.pendingCancelFeePaise ?? 0)),
      ]).catch(() => undefined);
    }
  }, [loadAddresses]);

  // Fetch shop config — smooth update, never blank between loads
  useEffect(() => {
    if (!shopId) return;
    let alive = true;
    // Return cached data instantly if available for this shop
    if (_shopDataShopId === shopId && _shopDataCache) {
      setShopData(_shopDataCache);
      setRiderAvailableFromCart(_shopDataCache.deliveryAvailable !== false);
    }
    void api.shop(shopId).then((s) => {
      if (alive) {
        const sv = s as ShopView;
        setShopData(sv);
        setRiderAvailableFromCart(sv.deliveryAvailable !== false);
        _shopDataCache = sv;
        _shopDataShopId = shopId;
      }
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [shopId]);

  // Self-heal the cart when it opens: drop any product that was deleted / made
  // unavailable since it was added (the server rejects placement otherwise with
  // "A product in your cart is no longer available", leaving the item un-clearable)
  // and refresh stale unit prices. Runs once per shop.
  useEffect(() => {
    if (!shopId) return;
    let alive = true;
    void reconcileWithCatalog().then(({ removed }) => {
      if (alive && removed.length > 0) {
        setError(t.cart.itemsRemovedUnavailable(removed.join(', ')));
      }
    });
    return () => { alive = false; };
  }, [shopId]);
  const bulkCart = useBulkCart();
  const [nearbyShops, setNearbyShops] = useState(() => {
    const pre = getPrefetchedCheckout();
    if (pre && pre.nearbyShops.length > 0) return pre.nearbyShops;
    return _nearbyShopsCache; // show immediately from cache on remount
  });
  const [nearbyLoading, setNearbyLoading] = useState(_nearbyShopsCache.length === 0);
  const nearbyShopIdRef = useRef<string | null>(_nearbyShopIdCache);
  useEffect(() => {
    const sid = shopId ?? nearbyShopIdRef.current;
    if (!sid) return;
    // Already have fresh data for this shop
    if (_nearbyShopIdCache === sid && _nearbyShopsCache.length > 0) {
      setNearbyShops(_nearbyShopsCache);
      setNearbyLoading(false);
      return;
    }
    const pre = getPrefetchedCheckout();
    if (pre?.nearbyShopsForShopId === sid && pre.nearbyShops.length > 0) {
      setNearbyShops(pre.nearbyShops);
      _nearbyShopsCache = pre.nearbyShops;
      _nearbyShopIdCache = sid;
      nearbyShopIdRef.current = sid;
      setNearbyLoading(false);
      return;
    }
    let alive = true;
    setNearbyLoading(true);
    void api.nearbyShopsForBulk(sid)
      .then((res) => {
        if (alive) {
          setNearbyShops(res.items);
          _nearbyShopsCache = res.items;
          _nearbyShopIdCache = sid;
          nearbyShopIdRef.current = sid;
        }
      })
      .catch(() => undefined)
      .finally(() => { if (alive) setNearbyLoading(false); });
    return () => { alive = false; };
  }, [shopId]);

  // Best-effort: capture the customer's current GPS position once, for the soft
  // "this address is X km from your current location" warning. Silent on failure.
  // Also hydrate the active delivery location from IDB (native + web post-startup).
  useEffect(() => {
    let alive = true;
    void idbGet<{ coords?: { lat: number; lng: number } | null }>(LOC_STORAGE_KEY).then((loc) => {
      if (alive && loc?.coords && Number.isFinite(loc.coords.lat) && Number.isFinite(loc.coords.lng)) {
        setDeliveryGeo(loc.coords);
      }
    });
    void getCurrentCoords({ timeoutMs: 10000 })
      .then((coords) => { if (alive && coords) setCurrentGeo(coords); })
      .finally(() => { if (alive) setGeoResolved(true); });
    return () => { alive = false; };
  }, []);

  // Reset the "proceed anyway" acknowledgement whenever the chosen address or
  // fulfilment changes — the warning must be re-accepted for a new destination.
  useEffect(() => {
    setFarConfirmed(false);
  }, [selectedAddress, fulfilment]);

  // Auto-select the BEST default address: nearest to the active "Delivering to"
  // location (falling back to live GPS). Only drops to the first saved address
  // once we know there's NO location signal at all — never picks "first" merely
  // because GPS hasn't resolved yet. Skips once the user has manually picked.
  useEffect(() => {
    if (addressPickedManually || addresses.length === 0) return;
    const valid = addresses.filter(
      (a) => Number.isFinite(Number(a.latitude)) && Number.isFinite(Number(a.longitude)),
    );
    const refGeo = deliveryGeo ?? currentGeo;
    if (refGeo && valid.length > 0) {
      const nearest = valid.reduce((best, a) => {
        const d = haversineMeters(refGeo, { lat: Number(a.latitude), lng: Number(a.longitude) });
        const bd = haversineMeters(refGeo, { lat: Number(best.latitude), lng: Number(best.longitude) });
        return d < bd ? a : best;
      });
      setSelectedAddress((prev) => prev ?? nearest.id);
    } else if (geoResolved) {
      // No delivery location and no GPS — fall back to the first saved address.
      setSelectedAddress((prev) => prev ?? addresses[0].id);
    }
  }, [addresses, deliveryGeo, currentGeo, geoResolved, addressPickedManually]);

  // Auto-switch fulfilment to the best available mode when shop data loads
  useEffect(() => {
    if (!shopData) return;
    if (platformDelivery && riderAvailableFromCart) {
      // Rider available → use platform delivery (distance-based fee, no shop fee)
      setFulfilment(DeliveryMode.PLATFORM_RIDER);
    } else if (platformDelivery && !riderAvailableFromCart) {
      // Platform delivery shop but no rider → fall back to self-pickup if available
      if (shopData?.selfPickupEnabled !== false) setFulfilment(DeliveryMode.SELF_PICKUP);
    }
  }, [platformDelivery, riderAvailableFromCart, shopData?.selfPickupEnabled]);

  // The +/- steppers must NEVER compute from a render-time `item.qty` (that value
  // goes stale the moment another line changes or on a rapid double-tap, which is
  // what made "-" misbehave once a different product had been decremented). Both
  // delegate to the store, which reads the CURRENT stored qty and steps from it.
  async function incQty(productId: string) {
    setError(null);
    await addOne(productId);
  }
  async function decQty(productId: string) {
    setError(null);
    await decOne(productId);
  }

  async function onClearCart() {
    setError(null);
    try {
      await clearCart();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function place() {
    const isPickupMode = fulfilment === DeliveryMode.SELF_PICKUP;
    // Delivery requires an address; pickup does not (collect from shop).
    if (!isPickupMode && !selectedAddress) {
      setError(t.cart.selectAddressError);
      return;
    }
    // Serviceable-area guard (client mirror of the server check): block a
    // delivery whose drop is outside the shop's admin-set delivery radius.
    // Recomputed here so the handler is authoritative even if render values lag.
    if (!isPickupMode && selectedAddress) {
      const addr = addresses.find((a) => a.id === selectedAddress);
      if (addr && shopGeo && deliveryRadiusMeters != null) {
        const alat = Number(addr.latitude);
        const alng = Number(addr.longitude);
        if (Number.isFinite(alat) && Number.isFinite(alng)) {
          const dist = haversineMeters(shopGeo, { lat: alat, lng: alng });
          if (Number.isFinite(dist) && dist > deliveryRadiusMeters) {
            setError(t.cart.outOfDeliveryRange);
            return;
          }
        }
      }
    }
    // Guard: never send a placement without a shop or lines. JSON.stringify drops
    // an `undefined` shopId, which the server reads as the legacy server-cart path
    // and rejects as "Cart is empty" — a confusing error for what is really a
    // malformed local cart. Surface a clear message and stop here instead.
    if (!localCart.shopId || localCart.lines.length === 0) {
      setError(t.cart.emptyTitle);
      return;
    }
    setPlacing(true);
    setPlacingStep(0);
    setError(null);
    let wasCancelled = false;
    const cancelHandle = { cancel: () => { wasCancelled = true; setPlacing(false); } };
    // Expose cancel handle so the overlay button can dismiss + auto-cancel
    setPlacingCancelHandle(cancelHandle);
    try {
      // Reuse the stable per-attempt key across retries (see idempotencyRef).
      if (!idempotencyRef.current) {
        idempotencyRef.current = `pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }
      const idempotencyKey = idempotencyRef.current;
      const userNote = notes.trim();
      const result = await api.placeOrder({
        deliveryMode: fulfilment,
        addressId: isPickupMode ? undefined : selectedAddress ?? undefined,
        paymentMethod: payment,
        idempotencyKey,
        notes: userNote || undefined,
        redeemCoins: appliedCoins > 0 ? appliedCoins : 0,
        // Exactly ONE discount source — a coupon takes precedence and clears any
        // offer (mutually exclusive; the server also rejects both together).
        offerId: appliedCoupon ? undefined : selectedOfferId ?? undefined,
        couponCode: appliedCoupon?.code ?? undefined,
        shopId: localCart.shopId ?? undefined,
        items: localCart.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
      } as Parameters<typeof api.placeOrder>[0]);
      if (wasCancelled) {
        // User tapped Cancel while request was in-flight — silently cancel the just-placed order
        void api.requestCancelOrder(result.orderId, 'Customer cancelled during placement').catch(() => undefined);
        return;
      }
      resetCartStore();
      idempotencyRef.current = null;
      onPlaced(result);
    } catch (e) {
      if (!wasCancelled) {
        const msg = (e as Error).message ?? '';
        // A deleted/unavailable product blocks the whole order. Prune it from the
        // cart so the user can retry, and tell them exactly what was removed.
        if (/no longer available|unavailable/i.test(msg)) {
          const { removed } = await reconcileWithCatalog();
          setError(
            removed.length > 0
              ? t.cart.itemsRemovedUnavailable(removed.join(', '))
              : friendlyMessage(e),
          );
        } else {
          setError(friendlyMessage(e));
        }
      }
    } finally {
      if (!wasCancelled) setPlacing(false);
      setPlacingCancelHandle(null);
    }
  }

  if (itemCount === 0 && !loadingAddrs) {
    return (
      <View style={styles.root}>
        <Header onBack={onBack} title={t.cart.title} />
        <EmptyState
          title={t.cart.emptyTitle}
          subtitle={t.cart.emptySubtitle}
          action={<Button label={t.cart.browseShops} onPress={onBrowse} fullWidth={false} />}
        />
      </View>
    );
  }

  const isPickup = fulfilment === DeliveryMode.SELF_PICKUP;
  // The offers/coupons the customer can apply (city offers + shop coupons),
  // preloaded on the shop object — no separate fetch.
  const availableOffers = shopData?.availableOffers ?? [];
  const activeOffer = availableOffers.find((o) => o.id === selectedOfferId) ?? null;

  // The SINGLE active discount source for this order. A coupon and an offer are
  // mutually exclusive (the UI clears one when the other is applied, and the
  // server rejects both). An applied coupon takes precedence. Both map onto the
  // shared computeBill offer params so the preview uses identical maths.
  const discountType = (appliedCoupon ? appliedCoupon.type : activeOffer?.type) as OfferType | undefined;
  const discountValue = appliedCoupon ? appliedCoupon.value : activeOffer?.value;
  const discountMinOrderPaise = appliedCoupon ? appliedCoupon.minOrderPaise : activeOffer?.minOrderPaise;
  const discountMaxPaise = appliedCoupon ? appliedCoupon.maxDiscountPaise : null;
  // A short label for the applied discount in the bill / entry row.
  const discountLabel = appliedCoupon ? appliedCoupon.code : activeOffer?.title;

  // Admin-set serviceable delivery radius (metres) for this shop's city. When
  // set, a drop beyond it is out of range (blocks delivery placement).
  const deliveryRadiusMeters =
    shopData?.deliveryRadiusMeters != null ? Number(shopData.deliveryRadiusMeters) : null;

  // Selected drop point (for the fee, the ETA, and the radius/far checks).
  const selectedAddr = addresses.find((a) => a.id === selectedAddress);
  const dropGeo = selectedAddr
    ? { lat: Number(selectedAddr.latitude), lng: Number(selectedAddr.longitude) }
    : null;
  const dropValid = !!dropGeo && Number.isFinite(dropGeo.lat) && Number.isFinite(dropGeo.lng);

  // ── Delivery fee (computed entirely on-device) ──
  //  - SELF_PICKUP        → ₹0
  //  - self-delivery      → the shop's flat fee (+ its free-delivery-above waiver)
  //  - PLATFORM_RIDER     → distance-tiered fee from the shop's deliveryTiers
  const deliveryTiers = shopData?.deliveryTiers ?? null;
  let deliveryFeeInput = 0;
  let freeDeliveryAbovePaise: number | null | undefined = null;
  if (isPickup) {
    deliveryFeeInput = 0;
    freeDeliveryAbovePaise = null;
  } else if (platformDelivery) {
    if (shopGeo && dropValid && dropGeo) {
      const distKm = haversineMeters(shopGeo, dropGeo) / 1000;
      if (deliveryTiers && deliveryTiers.length > 0) {
        const tier = deliveryTiers.find((tr) => distKm <= tr.maxKm) ?? deliveryTiers[deliveryTiers.length - 1];
        deliveryFeeInput = tier.feePaise;
      } else {
        deliveryFeeInput = platformDeliveryFeePaise(distKm * 1000);
      }
    } else if (deliveryTiers && deliveryTiers.length > 0) {
      // No address chosen yet — show the smallest tier as an indicative fee.
      deliveryFeeInput = Math.min(...deliveryTiers.map((tr) => tr.feePaise));
    } else {
      deliveryFeeInput = 0;
    }
    freeDeliveryAbovePaise = null;
  } else {
    deliveryFeeInput = shopData?.deliveryFeePaise ?? 0;
    freeDeliveryAbovePaise = shopData?.freeDeliveryAbovePaise ?? null;
  }

  // The itemized bill, computed with the SAME math the server uses. Subtotal +
  // items come from the local cart; fees + offer come from the shop config.
  const bill = shopData
    ? computeBill({
        subtotalPaise: localCart.totalPaise,
        deliveryFeePaise: deliveryFeeInput,
        freeDeliveryAbovePaise,
        offerType: discountType ?? null,
        offerValue: discountValue ?? null,
        offerMinOrderPaise: discountMinOrderPaise ?? null,
        offerMaxDiscountPaise: discountMaxPaise ?? null,
      })
    : null;

  // Min-order gate — from the shop's minOrderValuePaise vs the local subtotal.
  const minOrderValuePaise = shopData?.minOrderValuePaise ?? 0;
  const meetsMin = localCart.totalPaise >= minOrderValuePaise;
  const toMin = Math.max(0, minOrderValuePaise - localCart.totalPaise);

  const shownDeliveryFeePaise = isPickup ? 0 : bill?.deliveryFeePaise ?? 0;
  const freeDeliveryApplied = !isPickup && bill?.deliveryFeePaise === 0;
  // Coins redeem against the item subtotal only (1 coin = ₹1). Cap the applied
  // amount client-side to min(balance, subtotal) so the preview matches the
  // server, which re-caps on placement.
  // Coins redeem 1:1 (₹) against the POST-discount payable — matching the server,
  // which caps redemption at subtotal − discount. Capping against the raw subtotal
  // over-counts coins when an offer/coupon is applied and can drive "To pay"
  // negative and the coins-deducted line wrong.
  const payableBeforeCoinsPaise = bill ? Math.max(0, bill.subtotalPaise - bill.discountPaise) : 0;
  const redeemableRupees = Math.floor(payableBeforeCoinsPaise / 100);
  const appliedCoins = useCoins ? Math.min(coinBalance, redeemableRupees) : 0;
  const coinDiscountPaise = appliedCoins * 100;
  const shownTotalPaise = bill ? Math.max(0, bill.totalPaise - coinDiscountPaise) : 0;

  // Checkout time estimate: prep (scales with qty) + travel (shop → drop) for
  // delivery, or prep-only "Ready in ~" for pickup.
  const travelMeters =
    !isPickup && shopGeo && dropValid && dropGeo
      ? haversineMeters(shopGeo, dropGeo)
      : isPickup
        ? 0
        : null;
  const estMinutes = estimateOrderMinutes({ status: 'PLACED', itemCount, travelMeters });
  const estBand = formatMinutesBand(estMinutes);

  // ── Serviceable-area guard (hard block) ──
  // A delivery drop must be within the shop's admin-set delivery radius. Farther
  // (usually a different city) → order blocked. Only evaluated once we know the
  // shop coords, the drop coords, AND the radius; unknown values never block (the
  // server re-checks authoritatively).
  const shopDropMeters =
    shopGeo && dropValid && dropGeo ? haversineMeters(shopGeo, dropGeo) : null;
  const outOfDeliveryArea =
    !isPickup &&
    deliveryRadiusMeters != null &&
    shopDropMeters != null &&
    Number.isFinite(shopDropMeters) &&
    shopDropMeters > deliveryRadiusMeters;

  // ── Soft "far from your current location" warning ──
  // If the chosen address is well away from where the customer physically is
  // right now, warn (but allow proceeding). Threshold: 2 km. Only activates once
  // the user has MANUALLY picked an address — the one they arrived with (auto-
  // selected from home) must never trigger the popup.
  const FAR_FROM_ME_METERS = 2000;
  const meToDropMeters =
    !isPickup && currentGeo && dropValid && dropGeo
      ? haversineMeters(currentGeo, dropGeo)
      : null;
  const farFromCurrent =
    addressPickedManually &&
    meToDropMeters != null &&
    meToDropMeters > FAR_FROM_ME_METERS &&
    !outOfDeliveryArea;
  // Block placing until the far-warning is acknowledged (soft gate).
  const needsFarAck = farFromCurrent && !farConfirmed;

  // Show coupon screen as a full-screen overlay
  if (showCoupons) {
    return (
      <CouponScreen
        offers={availableOffers}
        selectedOfferId={selectedOfferId}
        selectedCouponCode={appliedCoupon?.code ?? null}
        subtotalPaise={bill?.subtotalPaise ?? 0}
        shopId={localCart.shopId ?? undefined}
        onApply={(id) => { setSelectedOfferId(id); if (id) setAppliedCoupon(null); }}
        onApplyCoupon={(c) => { setAppliedCoupon(c); if (c) setSelectedOfferId(null); }}
        onBack={() => setShowCoupons(false)}
      />
    );
  }

  return (
    <View style={styles.root}>
      <Header onBack={onBack} title={t.cart.title} subtitle={shopData?.name ?? localCart.shopName ?? undefined} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Items — rendered from the LOCAL cart (the only source of truth). */}
        <View style={styles.section}>
          {localCart.lines.map((item) => {
            const lineTotalPaise = item.unitPricePaise * item.qty;
            return (
              <View key={item.productId} style={styles.itemRow}>
                <ImageOrInitial uri={productImage(item.productId, item.imageUrl ?? undefined, 80, item.name)} name={item.name} style={styles.itemThumb} />
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={styles.itemUnit}>
                    {t.cart.each(formatRupees(item.unitPricePaise))}
                  </Text>
                </View>
                <View style={styles.itemRight}>
                  <View style={styles.stepper}>
                    <Pressable
                      style={styles.stepBtn}
                      onPress={() => decQty(item.productId)}
                    >
                      <Text style={styles.stepText}>−</Text>
                    </Pressable>
                    <Text style={styles.qty}>{item.qty}</Text>
                    <Pressable
                      style={styles.stepBtn}
                      onPress={() => incQty(item.productId)}
                    >
                      <Text style={styles.stepText}>+</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.lineTotal}>{formatRupees(lineTotalPaise)}</Text>
                </View>
              </View>
            );
          })}
          <View style={styles.cartActionsRow}>
            {localCart.shopId ? (
              <Pressable onPress={() => onOpenShop(localCart.shopId!)} style={styles.addMoreBtn}>
                <Text style={styles.addMoreText}>+ {t.cart.addMoreItems}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onClearCart} style={styles.clearBtn}>
              <Text style={styles.clearText}>{t.cart.clearCart}</Text>
            </Pressable>
          </View>
        </View>

        {/* Nearby shops bulk banner — only for platform-delivery shops. A
            self-delivery shop delivers its own orders, so a multi-shop (rider)
            basket can't be fulfilled — don't suggest it. */}
        {platformDelivery && (nearbyShops.length > 0 || nearbyLoading || nearbyShopIdRef.current) ? (() => {
          const bulkShopCount = currentBulkCartShops().length;
          if (bulkShopCount >= 3) return null;
          const shopsToShow = nearbyShops.filter((s) => !currentBulkCartShops().includes(s.id)).slice(0, 2);
          if (!nearbyLoading && shopsToShow.length === 0) return null;
          return (
            <View style={styles.bulkBanner}>
              <View style={styles.bulkBannerTop}>
                <Text style={styles.bulkBannerTitle}>Add from nearby shops</Text>
                <Text style={styles.bulkBannerSub}>
                  {nearbyLoading
                    ? 'Finding nearby shops…'
                    : shopsToShow.length > 0
                      ? shopsToShow.map((s) => s.name).join(' · ')
                      : 'Order from multiple shops in one delivery'}
                </Text>
              </View>
              {!nearbyLoading ? (
                <View style={styles.bulkBannerActions}>
                  {localCart.lines.length > 0 ? (
                    <Pressable
                      style={styles.bulkMoveBtn}
                      onPress={() => {
                        for (const line of localCart.lines) {
                          bulkCartAddOne(line.productId, {
                            shopId: shopId!,
                            shopName: shopData?.name ?? localCart.shopName ?? '',
                            name: line.name,
                            unitPricePaise: line.unitPricePaise,
                            imageUrl: line.imageUrl ?? null,
                          });
                        }
                        onOpenBulkCart?.();
                      }}
                    >
                      <Text style={styles.bulkMoveBtnText}>Move to multi-shop order</Text>
                    </Pressable>
                  ) : (
                    <Pressable style={styles.bulkOpenBtn} onPress={() => onOpenBulkCart?.()}>
                      <Text style={styles.bulkOpenBtnText}>View multi-shop cart</Text>
                    </Pressable>
                  )}
                </View>
              ) : null}
            </View>
          );
        })() : null}

        {/* Min-order gate */}
        {!meetsMin && toMin > 0 ? (
          <View style={styles.minGate}>
            <Text style={styles.minGateText}>
              {t.cart.minGate(formatRupees(toMin))}
            </Text>
          </View>
        ) : null}

        {/* Fulfilment: delivery vs self-pickup. Hide the whole section when
            self-pickup is disabled — no choice to offer, delivery is the only option. */}
        {shopData?.selfPickupEnabled !== false ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.cart.howWouldYouLikeIt}</Text>
          {/* Warn when platform delivery is selected but no rider is available */}
          {platformDelivery && !riderAvailableFromCart && fulfilment === DeliveryMode.SELF_DELIVERY ? (
            <View style={styles.noRiderBanner}>
              <Text style={styles.noRiderText}>No delivery riders available near this shop right now. Choose self-pickup or try again later.</Text>
            </View>
          ) : null}
          <View style={styles.segment}>
            <Pressable
              onPress={() => setFulfilment(DeliveryMode.SELF_DELIVERY)}
              style={[styles.segmentBtn, fulfilment === DeliveryMode.SELF_DELIVERY && styles.segmentBtnActive, platformDelivery && !riderAvailableFromCart && styles.segmentBtnDisabled]}
              accessibilityRole="radio"
              accessibilityState={{ selected: fulfilment === DeliveryMode.SELF_DELIVERY }}
              disabled={platformDelivery && !riderAvailableFromCart}
            >
              <Text style={[styles.segmentText, fulfilment === DeliveryMode.SELF_DELIVERY && styles.segmentTextActive]}>
                {platformDelivery && !riderAvailableFromCart ? 'Unavailable' : t.cart.delivery}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setFulfilment(DeliveryMode.SELF_PICKUP)}
              style={[styles.segmentBtn, isPickup && styles.segmentBtnActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: isPickup }}
            >
              <Text style={[styles.segmentText, isPickup && styles.segmentTextActive]}>
                {t.cart.selfPickup}
              </Text>
            </Pressable>
          </View>
          {isPickup ? (
            <Text style={styles.pickupNote}>{t.cart.pickupNoFee}</Text>
          ) : null}
        </View>
        ) : null}

        {/* Offer / coupon picker — Swiggy-style entry row. ALWAYS shown: shop
            offers, shop coupons AND NearBaz (platform-funded) city coupons all
            live behind this row, listed together in one place with exactly one
            applicable at a time. A NearBaz city coupon can exist even when the
            shop has no offers of its own, so the row must never be gated on
            availableOffers — otherwise the platform coupon is unreachable. */}
        {shopData ? (
          <View style={styles.section}>
            <Pressable style={styles.couponRow} onPress={() => setShowCoupons(true)}>
              <View style={styles.couponMid}>
                {(appliedCoupon || (selectedOfferId && bill?.offerApplied)) ? (
                  <>
                    <Text style={styles.couponAppliedTitle}>
                      {discountLabel ?? 'Discount applied'}
                    </Text>
                    <Text style={styles.couponSaving}>
                      {bill && bill.discountPaise > 0
                        ? `${formatRupees(bill.discountPaise)} off applied`
                        : 'Applied'}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.couponTitle}>{t.cart.applyOffer}</Text>
                    <Text style={styles.couponSub}>
                      {availableOffers.length
                        ? `${availableOffers.length} offers available`
                        : t.cart.viewCoupons}
                    </Text>
                  </>
                )}
              </View>
              <Text style={styles.couponArrow}>›</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Bill breakdown */}
        {bill ? (
          <View style={styles.section}>
            {/* ₹X saved banner */}
            {bill.offerApplied && bill.discountPaise > 0 ? (
              <View style={styles.savedBanner}>
                <Text style={styles.savedBannerText}>
                  {formatRupees(bill.discountPaise)} saved on this order!
                </Text>
              </View>
            ) : null}
            <Text style={styles.sectionTitle}>{t.cart.billDetails}</Text>
            <BillRow label={t.cart.itemSubtotal} value={formatRupees(bill.subtotalPaise)} />
            {bill.offerApplied && bill.discountPaise > 0 ? (
              <BillRow
                label={discountLabel ?? 'Discount'}
                value={`-${formatRupees(bill.discountPaise)}`}
                valueTone="success"
              />
            ) : null}
            <View style={styles.feeRow}>
              <View style={styles.flex}>
                <Text style={styles.billLabel}>
                  {isPickup
                    ? t.cart.deliveryFeePickup
                    : platformDelivery
                      ? t.cart.deliveryFeeByDistance
                      : t.cart.deliveryFee}
                </Text>
                <Text style={styles.feeSubtext}>
                  {isPickup
                    ? 'Self-pickup from the shop'
                    : platformDelivery
                      ? 'Delivered by a NearBaz rider'
                      : 'Delivered by the shop'}
                </Text>
              </View>
              <Text style={[styles.billValue, (isPickup || freeDeliveryApplied) ? styles.billSuccess : null]}>
                {isPickup ? '₹0.00' : freeDeliveryApplied ? t.cart.freeUpper : formatRupees(shownDeliveryFeePaise)}
              </Text>
            </View>
            <View style={styles.feeRow}>
              <View style={styles.flex}>
                <Text style={styles.billLabel}>{t.cart.platformFee}</Text>
                {bill.platformFeeBasePaise != null && bill.platformFeeGstPaise != null ? (
                  <Text style={styles.feeSubtext}>
                    {t.cart.platformFeeBreakdown(formatRupees(bill.platformFeeBasePaise), formatRupees(bill.platformFeeGstPaise))}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.billValue}>{formatRupees(bill.platformFeePaise)}</Text>
            </View>
            {isPickup ? (
              <Text style={styles.waiverNote}>{t.cart.pickupWaiver}</Text>
            ) : freeDeliveryApplied ? (
              <Text style={styles.waiverNote}>{t.cart.freeDeliveryApplied}</Text>
            ) : null}
            {coinBalance > 0 ? (
              <>
                <Divider style={styles.billDivider} />
                <Pressable
                  onPress={() => setUseCoins((v) => !v)}
                  style={styles.coinToggleRow}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: useCoins }}
                >
                  <View style={[styles.checkbox, useCoins && styles.checkboxActive]} />
                  <View style={styles.flex}>
                    <Text style={styles.coinToggleTitle}>{t.cart.useCoins}</Text>
                    <Text style={styles.coinToggleSub}>
                      {t.cart.coinsHint(coinBalance)}
                    </Text>
                  </View>
                  <CoinChip balance={coinBalance} showUnit={false} size="sm" onLight />
                </Pressable>
                {appliedCoins > 0 ? (
                  <View style={styles.billRow}>
                    <Text style={styles.coinLineLabel}>{t.cart.coinsLine}</Text>
                    <Text style={styles.coinLineValue}>− {formatRupees(coinDiscountPaise)}</Text>
                  </View>
                ) : null}
              </>
            ) : null}
            <Divider style={styles.billDivider} />
            <BillRow label={t.cart.toPay} value={formatRupees(shownTotalPaise)} bold />
          </View>
        ) : null}

        {/* Address — hidden for self-pickup (collect from shop instead) */}
        {isPickup ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t.cart.pickup}</Text>
            <View style={styles.pickupCard}>
              <View style={styles.flex}>
                <Text style={styles.pickupCardTitle}>{t.cart.collectFromShop}</Text>
                <Text style={styles.pickupCardSub}>
                  {shopData?.name
                    ? t.cart.pickupFromShop(shopData.name)
                    : localCart.shopName
                      ? t.cart.pickupFromShop(localCart.shopName)
                      : t.cart.pickupFromShopGeneric}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t.cart.deliveryAddress}</Text>
              <Pressable onPress={() => setShowAddrForm(true)}>
                <Text style={styles.link}>{t.cart.addNew}</Text>
              </Pressable>
            </View>

            {loadingAddrs ? (
              <Loading />
            ) : (() => {
              // Show ONLY the currently-selected address (nearest by default).
              const addr = addresses.find((a) => a.id === selectedAddress);
              if (!addr) {
                return (
                  <Text style={styles.namePrompt}>
                    {t.cart.selectAddressPrompt}
                  </Text>
                );
              }
              const addrGeo = { lat: Number(addr.latitude), lng: Number(addr.longitude) };
              const addrValid = Number.isFinite(addrGeo.lat) && Number.isFinite(addrGeo.lng);
              const addrTravel = shopGeo && addrValid ? haversineMeters(shopGeo, addrGeo) : null;
              const addrEta = formatMinutesBand(
                estimateOrderMinutes({ status: 'PLACED', itemCount, travelMeters: addrTravel }),
              );
              return (
                <View style={[styles.addrCard, styles.addrCardActive, outOfDeliveryArea && styles.addrCardBlocked]}>
                  <View style={styles.flex}>
                    <View style={styles.addrLabelRow}>
                      <Text style={styles.addrLabelText}>{addr.label}</Text>
                      {outOfDeliveryArea ? (
                        <Badge label={t.cart.outOfDeliveryArea} tone="danger" />
                      ) : addrEta ? (
                        <Text style={styles.addrEta}>~{addrEta}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.addrLine}>{addr.line}</Text>
                    {addr.landmark ? <Text style={styles.addrLandmark}>{t.common.near} {addr.landmark}</Text> : null}
                  </View>
                  {addresses.length > 1 ? (
                    <Pressable onPress={() => setShowAddrPicker(true)} hitSlop={8} style={styles.addrEditBtn} accessibilityLabel={t.common.change}>
                      <EditIcon size={18} color={theme.color.primary} />
                    </Pressable>
                  ) : null}
                </View>
              );
            })()}

            {/* Hard block: chosen address is outside the shop's delivery radius. */}
            {outOfDeliveryArea ? (
              <View style={styles.blockBanner}>
                <Text style={styles.blockTitle}>{t.cart.outsideAreaTitle}</Text>
                <Text style={styles.blockText}>{t.cart.outOfDeliveryRange}</Text>
                <Text style={styles.blockText}>
                  {t.cart.outsideAreaBody(
                    (shopDropMeters != null ? formatDistance(shopDropMeters) : null) ?? t.cart.tooFar,
                    shopData?.name ?? localCart.shopName ?? t.cart.theShop,
                  )}
                </Text>
              </View>
            ) : farFromCurrent && farConfirmed ? (
              /* Once acknowledged, a small confirmed chip stays in place of the modal. */
              <View style={styles.farChip}>
                <Text style={styles.farChipText}>
                  {t.cart.farConfirmed((meToDropMeters != null ? formatDistance(meToDropMeters) : null) ?? '')}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Payment method */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.cart.paymentMethod}</Text>
          {pendingCancelFeePaise > 0 ? (
            <View style={{ backgroundColor: '#FEF3C7', borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#FDE68A' }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#92400E' }}>
                Outstanding cancel fee: {formatRupees(pendingCancelFeePaise)}
              </Text>
              <Text style={{ fontSize: 12, color: '#78350F', marginTop: 2 }}>
                This amount will be added to your order total. COD is not available until it is cleared.
              </Text>
            </View>
          ) : null}
          <PaymentOption
            active={payment === PaymentMethod.UPI_DIRECT}
            onPress={() => setPayment(PaymentMethod.UPI_DIRECT)}
            title={t.cart.upiTitle}
            subtitle={pendingCancelFeePaise > 0 ? `${t.cart.upiSubtitle} · Cancel fee of ${formatRupees(pendingCancelFeePaise)} will be added` : t.cart.upiSubtitle}
          />
          <PaymentOption
            active={payment === PaymentMethod.COD}
            onPress={() => pendingCancelFeePaise > 0 ? undefined : setPayment(PaymentMethod.COD)}
            title={t.cart.codTitle}
            subtitle={pendingCancelFeePaise > 0 ? 'Not available — clear your outstanding cancel fee first' : t.cart.codSubtitle}
            disabled={pendingCancelFeePaise > 0}
          />
        </View>

        {/* Notes */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {isPickup ? t.cart.orderInstructions : t.cart.deliveryInstructions}
          </Text>
          <TextInput
            style={styles.notesInput}
            placeholder={t.cart.notesPlaceholder}
            placeholderTextColor={theme.color.textFaint}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      {/* Place order bar */}
      {bill ? (
        <View style={styles.placeBar}>
          <View>
            {estBand ? (
              <Text style={styles.etaLine}>
                {isPickup ? t.cart.readyIn(estBand) : t.cart.deliveryIn(estBand)}
              </Text>
            ) : null}
            <Text style={styles.placeTotalLabel}>{t.cart.total}</Text>
            <Text style={styles.placeTotal}>{formatRupees(shownTotalPaise)}</Text>
          </View>
          <View style={styles.placeBtnWrap}>
            <Button
              label={placing ? t.cart.placing : outOfDeliveryArea ? t.cart.addressOutOfArea : t.cart.placeOrder}
              onPress={place}
              busy={placing}
              disabled={!meetsMin || (!isPickup && !selectedAddress) || outOfDeliveryArea || needsFarAck}
              size="lg"
            />
          </View>
        </View>
      ) : null}

      {/* Full-screen "placing your order" overlay — animated step messages
          give the customer a sense of real progress instead of a frozen spinner. */}
      <PlacingOverlay
        visible={placing}
        step={placingStep}
        onStepChange={setPlacingStep}
        onCancel={() => placingCancelHandle?.cancel()}
      />

      {/* Centered popup: address is far from the customer's current location. */}
      <Modal
        visible={needsFarAck}
        transparent
        animationType="fade"
        onRequestClose={() => { /* must choose an option */ }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t.cart.farModalTitle}</Text>
            <Text style={styles.modalBody}>
              {t.cart.farModalBodyBefore}{' '}
              <Text style={styles.modalDistance}>
                {meToDropMeters != null ? formatDistance(meToDropMeters) : ''}
              </Text>{' '}
              {t.cart.farModalBodyAfter}
            </Text>
            <Button label={t.cart.farModalYes} onPress={() => setFarConfirmed(true)} />
            <Button
              label={t.cart.farModalChooseAnother}
              onPress={() => { setFarConfirmed(false); setShowAddrPicker(true); }}
              variant="ghost"
            />
          </View>
        </View>
      </Modal>

      {/* Address picker popup — switch between saved addresses. */}
      <Modal
        visible={showAddrPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddrPicker(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{t.cart.chooseAddress}</Text>
              <Pressable onPress={() => setShowAddrPicker(false)} hitSlop={8}>
                <Text style={styles.sheetClose}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
              {addresses.map((addr) => {
                const active = addr.id === selectedAddress;
                const g = { lat: Number(addr.latitude), lng: Number(addr.longitude) };
                const valid = Number.isFinite(g.lat) && Number.isFinite(g.lng);
                // For DELIVERY, an address beyond the shop's admin-set radius is
                // out of range and NOT selectable. Self-pickup ignores the radius
                // (any address is fine — the customer collects from the shop).
                const shopDist = shopGeo && valid ? haversineMeters(shopGeo, g) : null;
                const outArea =
                  !isPickup &&
                  deliveryRadiusMeters != null &&
                  shopDist != null &&
                  Number.isFinite(shopDist) &&
                  shopDist > deliveryRadiusMeters;
                const meDist = currentGeo && valid ? haversineMeters(currentGeo, g) : null;
                return (
                  <Pressable
                    key={addr.id}
                    disabled={outArea}
                    onPress={() => {
                      if (outArea) return; // out-of-range addresses are non-selectable
                      setSelectedAddress(addr.id);
                      setAddressPickedManually(true);
                      setShowAddrPicker(false);
                    }}
                    style={[styles.addrCard, active && styles.addrCardActive, outArea && styles.addrCardDisabled]}
                  >
                    <View style={styles.flex}>
                      <View style={styles.addrLabelRow}>
                        <Text style={styles.addrLabelText}>{addr.label}</Text>
                        {outArea ? <Badge label={t.cart.outOfRangeTag} tone="danger" /> : null}
                        {meDist != null ? (
                          <Text style={styles.addrEta}>{t.cart.distanceAway(formatDistance(meDist) ?? '')}</Text>
                        ) : null}
                      </View>
                      <Text style={styles.addrLine}>{addr.line}</Text>
                      {addr.landmark ? <Text style={styles.addrLandmark}>{t.common.near} {addr.landmark}</Text> : null}
                      {outArea ? <Text style={styles.addrOutOfRangeNote}>{t.cart.outOfDeliveryRange}</Text> : null}
                    </View>
                    <View style={[styles.radio, active && styles.radioActive]}>
                      {active ? <View style={styles.radioDot} /> : null}
                    </View>
                  </Pressable>
                );
              })}
              <Button
                label={t.cart.addNewAddress}
                variant="outline"
                onPress={() => { setShowAddrPicker(false); setShowAddrForm(true); }}
                style={styles.sheetAddBtn}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Add-new-address popup. */}
      <Modal
        visible={showAddrForm}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddrForm(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{t.cart.addAddress}</Text>
              <Pressable onPress={() => setShowAddrForm(false)} hitSlop={8}>
                <Text style={styles.sheetClose}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
              <AddressForm
                shopGeo={shopGeo}
                platformDelivery={platformDelivery}
                onSaved={async (id) => {
                  setShowAddrForm(false);
                  clearCheckoutPrefetch(); // stale after adding an address
                  await loadAddresses();
                  setSelectedAddress(id);
                  setAddressPickedManually(true);
                }}
                onError={setError}
                onCancel={() => setShowAddrForm(false)}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}


function Header({ onBack, title, subtitle }: { onBack: () => void; title: string; subtitle?: string }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerBack}>
        <Text style={styles.headerBackText}>←</Text>
      </Pressable>
      <View>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function BillRow({
  label,
  value,
  bold,
  valueTone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  valueTone?: 'success';
}) {
  return (
    <View style={styles.billRow}>
      <Text style={[styles.billLabel, bold && styles.billBold]}>{label}</Text>
      <Text
        style={[
          styles.billValue,
          bold && styles.billBold,
          valueTone === 'success' && styles.billSuccess,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function PaymentOption({
  active,
  onPress,
  title,
  subtitle,
  disabled,
}: {
  active: boolean;
  onPress: () => void;
  title: string;
  subtitle: string;
  disabled?: boolean;
}) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} style={[styles.payOption, active && styles.payOptionActive, disabled && { opacity: 0.45 }]}>
      <View style={styles.flex}>
        <Text style={styles.payTitle}>{title}</Text>
        <Text style={styles.paySubtitle}>{subtitle}</Text>
      </View>
      <View style={[styles.radio, active && styles.radioActive]}>
        {active ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

// ─── Placing overlay with animated step messages ──────────────────────────────

import { Circle, Path, Polyline, Rect, Svg } from 'react-native-svg';

const PLACING_STEPS = [
  {
    icon: (c: string) => (
      <Svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M5 12.55a11 11 0 0 1 14.08 0" />
        <Path d="M1.42 9a16 16 0 0 1 21.16 0" />
        <Path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <Circle cx={12} cy={20} r={1} fill={c} stroke="none" />
      </Svg>
    ),
    text: 'Connecting to shop',
  },
  {
    icon: (c: string) => (
      <Svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M16.5 9.4 7.55 4.24" />
        <Path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 2 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <Polyline points="3.29 7 12 12 20.71 7" />
        <Path d="M12 22V12" />
      </Svg>
    ),
    text: 'Checking your items',
  },
  {
    icon: (c: string) => (
      <Svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <Polyline points="9 12 11 14 15 10" />
      </Svg>
    ),
    text: 'Securing your order',
  },
  {
    icon: (c: string) => (
      <Svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <Polyline points="9 22 9 12 15 12 15 22" />
      </Svg>
    ),
    text: 'Sending to shop',
  },
  {
    icon: (c: string) => (
      <Svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <Polyline points="22 4 12 14.01 9 11.01" />
      </Svg>
    ),
    text: 'Almost there',
  },
];
const STEP_INTERVAL_MS = 1800;
const DOT_INTERVAL_MS = 400;

function PlacingOverlay({
  visible, step, onStepChange, onCancel,
}: {
  visible: boolean;
  step: number;
  onStepChange: (s: number) => void;
  onCancel: () => void;
}) {
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const stepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef(step);
  stepRef.current = step;
  const [dots, setDots] = useState('.');

  useEffect(() => {
    if (!visible) {
      if (stepIntervalRef.current) clearInterval(stepIntervalRef.current);
      if (dotIntervalRef.current) clearInterval(dotIntervalRef.current);
      return;
    }
    // Advance steps once, never loop — clamp at last step
    stepIntervalRef.current = setInterval(() => {
      const isLast = stepRef.current >= PLACING_STEPS.length - 1;
      if (isLast) { if (stepIntervalRef.current) clearInterval(stepIntervalRef.current); return; }
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        onStepChange(Math.min(stepRef.current + 1, PLACING_STEPS.length - 1));
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      });
    }, STEP_INTERVAL_MS);
    // Dot pulse: . → .. → ... → . (loops always)
    dotIntervalRef.current = setInterval(() => {
      setDots((d) => d.length >= 3 ? '.' : d + '.');
    }, DOT_INTERVAL_MS);
    return () => {
      if (stepIntervalRef.current) clearInterval(stepIntervalRef.current);
      if (dotIntervalRef.current) clearInterval(dotIntervalRef.current);
    };
  }, [visible]);

  const current = PLACING_STEPS[Math.min(step, PLACING_STEPS.length - 1)];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={poStyles.overlay}>
        <View style={poStyles.card}>
          <Animated.View style={[poStyles.stepRow, { opacity: fadeAnim }]}>
            {current.icon(theme.color.primary)}
            <Text style={poStyles.stepText}>
              {current.text}<Text style={poStyles.dots}>{dots}</Text>
            </Text>
          </Animated.View>
          <StripedProgressBar color={theme.color.primary} />
          <Pressable onPress={onCancel} style={poStyles.cancelBtn} hitSlop={8}>
            <Text style={poStyles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const poStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: theme.color.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space.xl,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: theme.color.bg,
    borderRadius: theme.radius.lg,
    padding: theme.space.xl,
    gap: theme.space.lg,
    alignItems: 'center',
    ...shadow.lg,
  },
  stepRow: { alignItems: 'center', gap: theme.space.sm },
  stepText: {
    fontSize: theme.font.h3,
    fontWeight: '700',
    color: theme.color.text,
    textAlign: 'center',
  },
  dots: {
    color: theme.color.primary,
    fontWeight: '800',
  },
  cancelBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.xl },
  cancelText: { fontSize: theme.font.small, color: theme.color.textMuted, fontWeight: '600' },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  flex: { flex: 1 },
  scroll: { paddingBottom: 120, gap: theme.space.md, paddingTop: theme.space.md },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    backgroundColor: theme.color.bg,
    ...shadow.sm,
  },
  headerBack: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBackText: { fontSize: 20, fontWeight: theme.weight.bold, color: theme.color.text },
  headerTitle: { fontSize: theme.font.h2, fontWeight: theme.weight.bold, color: theme.color.text },
  headerSubtitle: { fontSize: theme.font.small, color: theme.color.textMuted },

  section: {
    backgroundColor: theme.color.card,
    marginHorizontal: theme.space.lg,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    gap: theme.space.sm,
    ...shadow.sm,
  },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: theme.font.h3, fontWeight: theme.weight.bold, color: theme.color.text, marginBottom: 2 },
  link: { color: theme.color.primary, fontWeight: theme.weight.semibold, fontSize: theme.font.small },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingVertical: 4 },
  itemThumb: { width: 52, height: 52, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt },
  itemInfo: { flex: 1, gap: 2 },
  itemName: { fontSize: theme.font.body, fontWeight: theme.weight.semibold, color: theme.color.text },
  itemUnit: { fontSize: theme.font.small, color: theme.color.textMuted },
  itemRight: { alignItems: 'center', gap: 4 },
  lineTotal: { fontSize: theme.font.body, fontWeight: theme.weight.bold, color: theme.color.text, textAlign: 'center' },

  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.color.primary, borderRadius: theme.radius.md },
  stepBtn: { paddingHorizontal: theme.space.md, paddingVertical: 6 },
  stepText: { color: theme.color.onPrimary, fontSize: theme.font.h3, fontWeight: theme.weight.bold },
  qty: { color: theme.color.onPrimary, fontWeight: theme.weight.bold, minWidth: 20, textAlign: 'center' },

  clearBtn: { alignSelf: 'flex-start', paddingVertical: theme.space.sm },
  clearText: { color: theme.color.danger, fontWeight: theme.weight.semibold, fontSize: theme.font.small },
  cartActionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addMoreBtn: { alignSelf: 'flex-start', paddingVertical: theme.space.sm },
  addMoreText: { color: theme.color.primary, fontWeight: theme.weight.semibold, fontSize: theme.font.small },

  minGate: {
    marginHorizontal: theme.space.lg,
    backgroundColor: theme.color.warningLight,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
  },
  minGateText: { color: theme.color.warning, fontWeight: theme.weight.semibold, fontSize: theme.font.small },

  billRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  billLabel: { fontSize: theme.font.body, color: theme.color.textMuted },
  billValue: { fontSize: theme.font.body, color: theme.color.text },
  billBold: { fontWeight: theme.weight.bold, color: theme.color.text, fontSize: theme.font.h3 },
  billSuccess: { color: theme.color.success, fontWeight: theme.weight.bold },
  billDivider: { marginVertical: theme.space.sm },
  waiverNote: { fontSize: theme.font.small, color: theme.color.success, marginTop: 2 },

  coinToggleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingVertical: theme.space.xs },

  // Coupon entry row
  couponRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.space.sm,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: theme.color.border,
    padding: theme.space.md,
    ...shadow.sm,
  },
  couponIcon: { fontSize: 20 },
  couponMid: { flex: 1, gap: 2 },
  couponTitle: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  couponSub: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  couponAppliedTitle: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.success },
  couponSaving: { fontSize: theme.font.tiny, color: theme.color.success, fontWeight: '600' },
  couponArrow: { fontSize: 20, color: theme.color.textFaint },

  // ₹X saved banner
  savedBanner: {
    backgroundColor: '#ECFDF5', borderRadius: theme.radius.md,
    padding: theme.space.md, marginBottom: theme.space.sm,
    borderWidth: 1, borderColor: '#A7F3D0',
    alignItems: 'center',
  },
  savedBannerText: { fontSize: theme.font.body, fontWeight: '800', color: '#065F46' },

  offerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  offerChip: { borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.md, padding: theme.space.md, minWidth: 140, gap: 2, backgroundColor: theme.color.surface },
  offerChipActive: { borderColor: theme.color.success, backgroundColor: theme.color.successLight },
  offerChipTitle: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  offerChipTitleActive: { color: theme.color.success },
  offerChipMeta: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  offerChipMetaActive: { color: theme.color.success },
  offerChipApplied: { fontSize: theme.font.tiny, fontWeight: '800', color: theme.color.success, marginTop: 2 },
  coinToggleTitle: { fontSize: theme.font.body, fontWeight: theme.weight.semibold, color: theme.color.text },
  coinToggleSub: { fontSize: theme.font.small, color: '#B45309', fontWeight: theme.weight.medium },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: theme.radius.sm,
    borderWidth: 2,
    borderColor: theme.color.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: { borderColor: '#F59E0B', backgroundColor: '#F59E0B' },
  checkboxTick: { color: theme.color.onPrimary, fontSize: theme.font.small, fontWeight: theme.weight.bold },
  coinLineLabel: { fontSize: theme.font.body, color: '#B45309', fontWeight: theme.weight.semibold },
  coinLineValue: { fontSize: theme.font.body, color: '#B45309', fontWeight: theme.weight.bold },

  feeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  feeSubtext: { fontSize: theme.font.tiny, color: theme.color.textFaint, marginTop: 1 },

  segment: {
    flexDirection: 'row',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 3,
    gap: 3,
    marginTop: theme.space.xs,
  },
  segmentBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.space.sm,
    paddingHorizontal: 2,
    borderRadius: theme.radius.sm,
  },
  segmentBtnActive: { backgroundColor: theme.color.bg, ...shadow.sm },
  segmentText: { fontSize: theme.font.tiny, fontWeight: theme.weight.semibold, color: theme.color.textMuted, textAlign: 'center' },
  segmentTextActive: { color: theme.color.primary },
  pickupNote: { fontSize: theme.font.small, color: theme.color.success, marginTop: theme.space.sm, fontWeight: theme.weight.medium },
  noRiderBanner: { backgroundColor: '#FFF7ED', borderRadius: theme.radius.md, padding: theme.space.sm, borderWidth: 1, borderColor: '#FED7AA', marginBottom: theme.space.sm },
  noRiderText: { fontSize: theme.font.small, color: '#92400E', lineHeight: 18 },
  segmentBtnDisabled: { opacity: 0.4 },

  addrCard: {
    flexDirection: 'row',
    gap: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    borderColor: theme.color.border,
    marginTop: theme.space.sm,
    alignItems: 'flex-start',
  },
  addrCardActive: { borderColor: theme.color.primary, backgroundColor: theme.color.primaryLight },
  addrCardBlocked: { borderColor: theme.color.danger, backgroundColor: theme.color.dangerLight },
  addrCardDisabled: { opacity: 0.55 },
  addrOutOfRangeNote: { fontSize: theme.font.tiny, color: theme.color.danger, marginTop: 4, fontWeight: theme.weight.semibold },
  addrLabelRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, marginBottom: 4, flexWrap: 'wrap' },
  addrLabelText: { fontSize: theme.font.small, fontWeight: theme.weight.bold, color: theme.color.text },
  addrEta: { fontSize: theme.font.tiny, color: theme.color.primary, fontWeight: theme.weight.semibold },
  addrEditBtn: {
    width: 30,
    height: 30,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  addrEditIcon: { fontSize: 15, color: theme.color.textMuted, fontWeight: theme.weight.bold },

  blockBanner: {
    marginTop: theme.space.sm,
    backgroundColor: theme.color.dangerLight,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.danger,
    padding: theme.space.md,
    gap: 4,
  },
  blockTitle: { fontSize: theme.font.body, fontWeight: theme.weight.bold, color: theme.color.danger },
  blockText: { fontSize: theme.font.small, color: theme.color.text, lineHeight: 19 },

  farChip: {
    marginTop: theme.space.sm,
    alignSelf: 'flex-start',
    backgroundColor: theme.color.successLight,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.xs,
  },
  farChipText: { fontSize: theme.font.tiny, color: theme.color.success, fontWeight: theme.weight.semibold },

  addrHeadActions: { flexDirection: 'row', gap: theme.space.md, alignItems: 'center' },
  addrPin: { fontSize: 20, marginTop: 2 },
  namePrompt: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space.sm },

  sheetBackdrop: { flex: 1, backgroundColor: theme.color.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.color.bg,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.lg,
    paddingBottom: theme.space.xl,
    width: '100%',
    maxWidth: theme.maxContentWidth,
    alignSelf: 'center',
    maxHeight: '88%',
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.space.sm },
  sheetTitle: { fontSize: theme.font.h2, fontWeight: theme.weight.bold, color: theme.color.text },
  sheetClose: { fontSize: theme.font.h2, color: theme.color.textMuted, fontWeight: theme.weight.bold },
  sheetScroll: { flexGrow: 0 },
  sheetAddBtn: { marginTop: theme.space.md },

  // Centered "far from your location" popup.
  modalBackdrop: {
    flex: 1,
    backgroundColor: theme.color.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space.xl,
  },
  modalCard: {
    backgroundColor: theme.color.bg,
    borderRadius: theme.radius.lg,
    padding: theme.space.xl,
    gap: theme.space.sm,
    width: '100%',
    maxWidth: 360,
    alignItems: 'stretch',
  },
  modalEmoji: { fontSize: 40, textAlign: 'center' },
  modalTitle: { fontSize: theme.font.h2, fontWeight: theme.weight.bold, color: theme.color.text, textAlign: 'center' },
  modalBody: { fontSize: theme.font.body, color: theme.color.textMuted, textAlign: 'center', marginBottom: theme.space.sm, lineHeight: 21 },
  modalDistance: { color: theme.color.text, fontWeight: theme.weight.bold },
  addrLine: { fontSize: theme.font.body, color: theme.color.text, fontWeight: theme.weight.medium },
  addrLandmark: { fontSize: theme.font.small, color: theme.color.textMuted },

  pickupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    borderColor: theme.color.primary,
    backgroundColor: theme.color.primaryLight,
    marginTop: theme.space.sm,
  },
  pickupCardEmoji: { fontSize: 24 },
  pickupCardTitle: { fontSize: theme.font.body, fontWeight: theme.weight.bold, color: theme.color.text },
  pickupCardSub: { fontSize: theme.font.small, color: theme.color.textMuted },

  radio: {
    width: 22,
    height: 22,
    borderRadius: theme.radius.pill,
    borderWidth: 2,
    borderColor: theme.color.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioActive: { borderColor: theme.color.primary },
  radioDot: { width: 10, height: 10, borderRadius: theme.radius.pill, backgroundColor: theme.color.primary },

  payOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    borderColor: theme.color.border,
    marginTop: theme.space.sm,
  },
  payOptionActive: { borderColor: theme.color.primary, backgroundColor: theme.color.primaryLight },
  payEmoji: { fontSize: 24 },
  payTitle: { fontSize: theme.font.body, fontWeight: theme.weight.bold, color: theme.color.text },
  paySubtitle: { fontSize: theme.font.small, color: theme.color.textMuted },

  notesInput: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    fontSize: theme.font.body,
    color: theme.color.text,
    minHeight: 60,
    textAlignVertical: 'top',
  },

  error: {
    color: theme.color.danger,
    textAlign: 'center',
    marginHorizontal: theme.space.lg,
    fontWeight: theme.weight.medium,
  },

  placeBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.lg,
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.lg,
    backgroundColor: theme.color.bg,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    ...shadow.lg,
  },
  placeTotalLabel: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  etaLine: { fontSize: theme.font.small, color: theme.color.primary, fontWeight: theme.weight.bold, marginBottom: 2 },
  placeTotal: { fontSize: theme.font.h2, fontWeight: theme.weight.heavy, color: theme.color.text },
  placeBtnWrap: { flex: 1 },

  placingOverlay: {
    flex: 1,
    backgroundColor: theme.color.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space.xl,
  },
  placingCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: theme.color.bg,
    borderRadius: theme.radius.lg,
    padding: theme.space.xl,
    gap: theme.space.lg,
    ...shadow.lg,
  },
  placingText: {
    fontSize: theme.font.h3,
    fontWeight: theme.weight.bold,
    color: theme.color.text,
    textAlign: 'center',
  },
  placingCancelBtn: { alignSelf: 'center', paddingVertical: theme.space.sm, paddingHorizontal: theme.space.xl },
  placingCancelText: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },

  // ── Nearby-shops bulk upgrade banner ──
  bulkBanner: {
    marginHorizontal: theme.space.lg,
    backgroundColor: '#F5F3FF',
    borderRadius: theme.radius.lg,
    borderWidth: 1.5,
    borderColor: '#7C3AED',
    padding: theme.space.md,
    gap: theme.space.sm,
    ...shadow.sm,
  },
  bulkBannerTop: { gap: 2 },
  bulkBannerTitle: {
    fontSize: theme.font.body,
    fontWeight: theme.weight.bold,
    color: '#5B21B6',
  },
  bulkBannerSub: {
    fontSize: theme.font.small,
    color: '#7C3AED',
    fontWeight: theme.weight.medium,
  },
  bulkBannerActions: { flexDirection: 'row', gap: theme.space.sm, marginTop: 2 },
  bulkMoveBtn: {
    flex: 1,
    backgroundColor: '#7C3AED',
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.sm,
    alignItems: 'center',
  },
  bulkMoveBtnText: {
    color: '#fff',
    fontWeight: theme.weight.bold,
    fontSize: theme.font.small,
  },
  bulkOpenBtn: {
    flex: 1,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.sm,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#7C3AED',
  },
  bulkOpenBtnText: {
    color: '#7C3AED',
    fontWeight: theme.weight.bold,
    fontSize: theme.font.small,
  },
});
