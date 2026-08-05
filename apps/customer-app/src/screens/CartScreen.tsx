import { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PaymentMethod, DeliveryMode, OfferType, computeBill, platformDeliveryFeePaise } from '@passwaala/shared';
import type { PlaceOrderResult } from '@passwaala/shared';
import { api } from '../api';
import { clearCart, setQty, useCart, resetCartStore } from '../cart';
import type { Address, ShopView } from '../types';
import { AddressForm } from '../components/AddressForm';
import { CouponScreen } from './CouponScreen';
import { estimateOrderMinutes, formatDistance, formatMinutesBand, formatRupees, haversineMeters, productImage, shadow, theme } from '../theme';
import { Badge, Button, CoinChip, Divider, EmptyState, Loading } from '../ui';
import { ImageOrInitial } from '../ImageOrInitial';
import { getPrefetchedCheckout, clearCheckoutPrefetch } from '../checkoutPrefetch';
import { StripedProgressBar } from '../StripedProgressBar';
import { useLang } from '../i18n/LanguageContext';

/**
 * CartScreen — cart review + checkout (plan → Cart & Checkout). Line items with
 * +/- and remove, the SIGNATURE itemized bill breakdown (subtotal + delivery +
 * flat ₹10 platform fee with free-delivery note), min-order gating, clear cart,
 * saved-address selection + add form, payment picker, and place order with a
 * per-attempt idempotency key.
 */
export function CartScreen({
  onBack,
  onBrowse,
  onOpenShop,
  onPlaced,
}: {
  onBack: () => void;
  onBrowse: () => void;
  onOpenShop: (shopId: string) => void;
  onPlaced: (result: PlaceOrderResult) => void;
}) {
  const { t } = useLang();
  const localCart = useCart();
  const itemCount = localCart.itemCount;
  // The shop's fee/offer/coords config — fetched ONCE from api.shop(). Items and
  // subtotal come from the LOCAL cart; the bill is computed entirely on-device
  // (see computedBill below) with NO server sync until the order is placed.
  const [shopData, setShopData] = useState<ShopView | null>(null);
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
  const [error, setError] = useState<string | null>(null);
  const [showAddrForm, setShowAddrForm] = useState(false);
  // Modal to switch between saved addresses (the cart shows only one at a time).
  const [showAddrPicker, setShowAddrPicker] = useState(false);
  const [coinBalance, setCoinBalance] = useState(0);
  const [useCoins, setUseCoins] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [showCoupons, setShowCoupons] = useState(false);
  // Customer's current GPS position (best-effort) for the soft "far from your
  // current location" warning. Null until/if geolocation resolves.
  const [currentGeo, setCurrentGeo] = useState<{ lat: number; lng: number } | null>(null);
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
  // Whether this shop delivers via PassWaala riders (distance-tiered fee) vs
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
    // Addresses + coin balance load once. The authoritative bill is produced by
    // the debounced sync effect below (which also re-runs on qty/mode changes).
    void loadAddresses();
    // Coin balance: use the prefetched value if warm, else fetch.
    const pre = getPrefetchedCheckout();
    if (pre) {
      setCoinBalance(pre.coinBalance);
    } else {
      void api
        .referralMe()
        .then((r) => setCoinBalance(r?.coinBalance ?? 0))
        .catch(() => setCoinBalance(0));
    }
  }, [loadAddresses]);

  // Fetch the shop's fee/offer/coords config ONCE (drives the entire locally-
  // computed bill). Also fetch rider availability (a lightweight check) so the
  // "no rider nearby" banner still works — neither call touches the cart.
  const shopId = localCart.shopId;
  useEffect(() => {
    if (!shopId) return;
    let alive = true;
    void api
      .shop(shopId)
      .then((s) => {
        if (alive) setShopData(s as ShopView);
      })
      .catch(() => undefined);
    void api
      .shopDeliveryAvailable(shopId)
      .then((d) => { if (alive) setRiderAvailableFromCart(d.deliveryAvailable !== false); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [shopId]);

  // Best-effort: capture the customer's current GPS position once, for the soft
  // "this address is X km from your current location" warning. Silent on failure.
  useEffect(() => {
    const geo =
      typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : null;
    if (!geo) return;
    let alive = true;
    geo.getCurrentPosition(
      (pos) => { if (alive) setCurrentGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { /* denied / unavailable — no warning shown */ },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
    return () => { alive = false; };
  }, []);

  // Reset the "proceed anyway" acknowledgement whenever the chosen address or
  // fulfilment changes — the warning must be re-accepted for a new destination.
  useEffect(() => {
    setFarConfirmed(false);
  }, [selectedAddress, fulfilment]);

  // Auto-select the BEST default address: nearest to the customer's current
  // location when GPS is known, else the first saved one. Skips once the user
  // has manually picked, and never overrides an existing manual choice.
  useEffect(() => {
    if (addressPickedManually || addresses.length === 0) return;
    const valid = addresses.filter(
      (a) => Number.isFinite(Number(a.latitude)) && Number.isFinite(Number(a.longitude)),
    );
    if (currentGeo && valid.length > 0) {
      const nearest = valid.reduce((best, a) => {
        const d = haversineMeters(currentGeo, { lat: Number(a.latitude), lng: Number(a.longitude) });
        const bd = haversineMeters(currentGeo, { lat: Number(best.latitude), lng: Number(best.longitude) });
        return d < bd ? a : best;
      });
      setSelectedAddress((prev) => prev ?? nearest.id);
    } else {
      setSelectedAddress((prev) => prev ?? addresses[0].id);
    }
  }, [addresses, currentGeo, addressPickedManually]);

  // Auto-switch to self-pickup if platform delivery becomes unavailable
  useEffect(() => {
    if (platformDelivery && !riderAvailableFromCart && fulfilment === DeliveryMode.SELF_DELIVERY) {
      if (shopData?.selfPickupEnabled !== false) {
        setFulfilment(DeliveryMode.SELF_PICKUP);
      }
    }
  }, [platformDelivery, riderAvailableFromCart, fulfilment, shopData?.selfPickupEnabled]);

  async function changeQty(productId: string, qty: number) {
    setError(null);
    // Instant, local-only update — the line list AND the bill both render from
    // the local cart, so +/- reflects immediately with no server round-trip.
    await setQty(productId, qty);
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
    setPlacing(true);
    setError(null);
    try {
      // NO pre-placement server sync — the local cart IS the source of truth. The
      // server re-validates stock/price/fee/offer from these client items, so we
      // pass { shopId, items } straight through (client-cart path in place()).
      const idempotencyKey = `pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const userNote = notes.trim();
      // Coins redeem against the item subtotal only (1 coin = ₹1). Cap
      // client-side to min(balance, subtotal); the server re-caps anyway.
      const subtotalRupees = Math.floor(localCart.totalPaise / 100);
      const appliedCoins = useCoins ? Math.min(coinBalance, subtotalRupees) : 0;
      const result = await api.placeOrder({
        deliveryMode: fulfilment,
        // Address is optional for pickup; only send it for delivery.
        addressId: isPickupMode ? undefined : selectedAddress ?? undefined,
        paymentMethod: payment,
        idempotencyKey,
        notes: userNote || undefined,
        redeemCoins: appliedCoins > 0 ? appliedCoins : 0,
        offerId: selectedOfferId ?? undefined,
        // Client cart pushed at placement (the ONLY moment items reach the server).
        shopId: localCart.shopId ?? undefined,
        items: localCart.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
      } as Parameters<typeof api.placeOrder>[0]);
      // Order placed — clear the local cart.
      resetCartStore();
      onPlaced(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPlacing(false);
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
        offerType: (activeOffer?.type as OfferType | undefined) ?? null,
        offerValue: activeOffer?.value ?? null,
        offerMinOrderPaise: activeOffer?.minOrderPaise ?? null,
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
  const subtotalRupees = Math.floor((bill?.subtotalPaise ?? 0) / 100);
  const appliedCoins = useCoins ? Math.min(coinBalance, subtotalRupees) : 0;
  const coinDiscountPaise = appliedCoins * 100;
  const shownTotalPaise = bill ? bill.totalPaise - coinDiscountPaise : 0;

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
        subtotalPaise={bill?.subtotalPaise ?? 0}
        shopId={localCart.shopId ?? undefined}
        onApply={(id) => setSelectedOfferId(id)}
        onApplyCoupon={(code) => { /* TODO: pass coupon code to order placement */ }}
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
                      onPress={() => changeQty(item.productId, item.qty - 1)}
                    >
                      <Text style={styles.stepText}>−</Text>
                    </Pressable>
                    <Text style={styles.qty}>{item.qty}</Text>
                    <Pressable
                      style={styles.stepBtn}
                      onPress={() => changeQty(item.productId, item.qty + 1)}
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

        {/* Offer / coupon picker — Swiggy-style entry row */}
        {availableOffers.length ? (
          <View style={styles.section}>
            <Pressable style={styles.couponRow} onPress={() => setShowCoupons(true)}>
              <View style={styles.couponMid}>
                {selectedOfferId && bill?.offerApplied && bill.discountPaise > 0 ? (
                  <>
                    <Text style={styles.couponAppliedTitle}>
                      {activeOffer?.title ?? 'Offer applied'}
                    </Text>
                    <Text style={styles.couponSaving}>
                      {formatRupees(bill.discountPaise)} off applied
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.couponTitle}>{t.cart.applyOffer}</Text>
                    <Text style={styles.couponSub}>
                      {availableOffers.length} offers available
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
                label={activeOffer?.title ?? 'Offer discount'}
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
                      ? 'Delivered by a PassWaala rider'
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
                    <Pressable onPress={() => setShowAddrPicker(true)} hitSlop={8} style={styles.addrEditBtn}>
                      <Text style={styles.addrEditIcon}>{t.common.change}</Text>
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
          <PaymentOption
            active={payment === PaymentMethod.UPI_DIRECT}
            onPress={() => setPayment(PaymentMethod.UPI_DIRECT)}
            title={t.cart.upiTitle}
            subtitle={t.cart.upiSubtitle}
          />
          <PaymentOption
            active={payment === PaymentMethod.COD}
            onPress={() => setPayment(PaymentMethod.COD)}
            title={t.cart.codTitle}
            subtitle={t.cart.codSubtitle}
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

      {/* Full-screen "placing your order" overlay — order placement can take a
          few seconds on the current server, so block interaction + show clear
          progress instead of just a button spinner. */}
      <Modal visible={placing} transparent animationType="fade" onRequestClose={() => { /* can't dismiss mid-place */ }}>
        <View style={styles.placingOverlay}>
          <View style={styles.placingCard}>
            <Text style={styles.placingText}>{t.cart.placing}</Text>
            <StripedProgressBar color={theme.color.primary} />
          </View>
        </View>
      </Modal>

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
}: {
  active: boolean;
  onPress: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.payOption, active && styles.payOptionActive]}>
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
});
