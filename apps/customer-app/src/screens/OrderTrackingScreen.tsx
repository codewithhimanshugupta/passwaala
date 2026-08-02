import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { OrderStatus, PaymentMethod, DeliveryMode, buildUpiDeepLink } from '@passwaala/shared';
import type { PlaceOrderResult } from '@passwaala/shared';
import { api } from '../api';
import type { OrderDetail } from '../types';
import { estimateOrderMinutes, formatMinutesBand, formatRupees, haversineMeters, shadow, theme } from '../theme';
import { Badge, Button, Divider, ErrorState, Loading } from '../ui';
import { TrackingMap } from '../components/TrackingMap';
import { UpiQr } from '../components/UpiQr';
import { DisputeModal, type DisputeModalHandle } from '../components/DisputeModal';
import { useLang } from '../i18n/LanguageContext';
import type { Strings } from '../i18n/strings';
import { canNotify, notifyOrderUpdate, requestNotifyPermission } from '../notify';

type TimelineStep = { key: OrderStatus; label: string; caption: string; icon: string };

/** Friendly, collapsed 4-step DELIVERY timeline. Terminal states get their own display. */
function deliveryTimeline(t: Strings): TimelineStep[] {
  return [
    { key: OrderStatus.PLACED, label: t.orderTracking.timelineOrderPlaced, caption: t.orderTracking.timelineOrderPlacedCaption, icon: '📝' },
    { key: OrderStatus.PREPARING, label: t.orderTracking.timelinePreparing, caption: t.orderTracking.timelinePreparingCaption, icon: '👨‍🍳' },
    { key: OrderStatus.OUT_FOR_DELIVERY, label: t.orderTracking.timelineOutForDelivery, caption: t.orderTracking.timelineOutForDeliveryCaption, icon: '🛵' },
    { key: OrderStatus.DELIVERED, label: t.orderTracking.timelineDelivered, caption: t.orderTracking.timelineDeliveredCaption, icon: '✅' },
  ];
}

/** Self-pickup timeline — same status keys, pickup-flavoured labels (no delivery language). */
function pickupTimeline(t: Strings): TimelineStep[] {
  return [
    { key: OrderStatus.PLACED, label: t.orderTracking.timelineOrderPlaced, caption: t.orderTracking.timelineOrderPlacedCaption, icon: '📝' },
    { key: OrderStatus.PREPARING, label: t.orderTracking.timelinePreparing, caption: t.orderTracking.timelinePreparingCaption, icon: '👨‍🍳' },
    { key: OrderStatus.OUT_FOR_DELIVERY, label: t.orderTracking.timelineReadyForPickup, caption: t.orderTracking.timelineReadyForPickupCaption, icon: '🏬' },
    { key: OrderStatus.DELIVERED, label: t.orderTracking.timelineCollected, caption: t.orderTracking.timelineCollectedCaption, icon: '✅' },
  ];
}

/**
 * Platform-rider timeline — adds a distinct "Ready" step so the customer sees the
 * order is packed and waiting for a rider to collect it (READY / RIDER_ASSIGNED),
 * rather than being stuck on "Preparing".
 */
function riderTimeline(t: Strings): TimelineStep[] {
  return [
    { key: OrderStatus.PLACED, label: t.orderTracking.timelineOrderPlaced, caption: t.orderTracking.timelineOrderPlacedCaption, icon: '📝' },
    { key: OrderStatus.PREPARING, label: t.orderTracking.timelinePreparing, caption: t.orderTracking.timelinePreparingCaption, icon: '👨‍🍳' },
    { key: OrderStatus.READY, label: t.orderTracking.timelineReady, caption: t.orderTracking.timelineReadyCaption, icon: '📦' },
    { key: OrderStatus.OUT_FOR_DELIVERY, label: t.orderTracking.timelineOutForDelivery, caption: t.orderTracking.timelineOutForDeliveryCaption, icon: '🛵' },
    { key: OrderStatus.DELIVERED, label: t.orderTracking.timelineDelivered, caption: t.orderTracking.timelineDeliveredCaption, icon: '✅' },
  ];
}

/** Pick the right step set for the order's delivery mode. */
function timelineFor(deliveryMode: DeliveryMode | string, t: Strings): TimelineStep[] {
  if (deliveryMode === DeliveryMode.SELF_PICKUP) return pickupTimeline(t);
  if (deliveryMode === DeliveryMode.PLATFORM_RIDER) return riderTimeline(t);
  return deliveryTimeline(t);
}

/**
 * Collapse a real order status onto the canonical timeline-step key it belongs
 * to. READY and RIDER_ASSIGNED both read as "Ready" (packed, awaiting pickup).
 */
function canonicalKey(status: OrderStatus): OrderStatus | null {
  switch (status) {
    case OrderStatus.PLACED:
    case OrderStatus.ACCEPTED:
    case OrderStatus.AWAITING_PAYMENT:
      return OrderStatus.PLACED;
    case OrderStatus.PREPARING:
      return OrderStatus.PREPARING;
    case OrderStatus.READY:
    case OrderStatus.RIDER_ASSIGNED:
      return OrderStatus.READY;
    case OrderStatus.OUT_FOR_DELIVERY:
      return OrderStatus.OUT_FOR_DELIVERY;
    case OrderStatus.DELIVERED:
      return OrderStatus.DELIVERED;
    default:
      return null; // terminal/exception
  }
}

/** Map a real order status onto an index in the given timeline. -1 = terminal. */
function stepIndexFor(status: OrderStatus, timeline: TimelineStep[]): number {
  const key = canonicalKey(status);
  if (key === null) return -1;
  const idx = timeline.findIndex((s) => s.key === key);
  if (idx !== -1) return idx;
  // This timeline has no such step (e.g. READY on a self-delivery timeline) —
  // fold it into "Preparing" so it still shows in-progress.
  return timeline.findIndex((s) => s.key === OrderStatus.PREPARING);
}

const TERMINAL_BAD = new Set<OrderStatus>([
  OrderStatus.REJECTED,
  OrderStatus.CANCELLED,
  OrderStatus.REFUND_PENDING,
  OrderStatus.REFUNDED,
]);

/** Human-readable "who cancelled" for the refund audit summary. */
function cancelledByLabel(by: string | null | undefined, shopName: string): string {
  switch (by) {
    case 'SHOP': return shopName;
    case 'CUSTOMER': return 'you';
    case 'RIDER': return 'the delivery partner';
    case 'SYSTEM': return 'PassWaala (auto-cancelled)';
    default: return shopName;
  }
}

/**
 * OrderTrackingScreen — confirmation + live tracking (plan → Order lifecycle).
 * Shows a success header, an itemized recap, a vertical status timeline fed by
 * api.order(id), and for UPI orders a "Pay now" deep-link + "I've paid" action
 * calling confirmPayment. Polls every few seconds while the order is active.
 */
export function OrderTrackingScreen({
  orderId,
  placeResult,
  onDone,
}: {
  orderId: string;
  placeResult?: PlaceOrderResult;
  onDone: () => void;
}) {
  const { t } = useLang();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [refundBusy, setRefundBusy] = useState(false);
  const disputeRef = useRef<DisputeModalHandle | null>(null);
  // Nudge: one-time message to the shop while order is active
  const [showNudge, setShowNudge] = useState(false);
  const [nudgeText, setNudgeText] = useState('');
  const [sendingNudge, setSendingNudge] = useState(false);
  // Guard so we auto-open the UPI app only ONCE when the shop requests payment
  // (the order flips to AWAITING_PAYMENT), not on every poll thereafter.
  const autoPaidPromptedRef = useRef(false);
  // Tracks whether the previous poll saw an open payment claim, so we can detect
  // the shop clearing it ("not received") and re-prompt the customer to pay.
  const hadClaimRef = useRef(false);
  // Previous order state — used to detect changes and fire browser notifications.
  const prevOrderRef = useRef<OrderDetail | null>(null);

  // Request notification permission once on mount (silently — no prompt yet,
  // just prime it so we can fire when backgrounded).
  useEffect(() => {
    if (!canNotify()) {
      requestNotifyPermission().catch(() => undefined);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const o = (await api.order(orderId)) as OrderDetail;
      setOrder(o);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while the order is still active (not delivered / terminal).
  useEffect(() => {
    if (!order) return;
    const done = order.status === OrderStatus.DELIVERED || TERMINAL_BAD.has(order.status);
    if (done) return;
    const t = setInterval(() => {
      void load();
    }, 12000);
    return () => clearInterval(t);
  }, [order, load]);

  // Payment prompt: only on the FRESH placement flow (placeResult present) do we
  // auto-open the UPI app once for an AWAITING_PAYMENT UPI order. Opening the same
  // order later from Order history (no placeResult) must NOT hijack into the UPI
  // app — the "Pay now with UPI" button stays available for manual payment.
  useEffect(() => {
    if (!order || !placeResult) return;
    const awaiting = order.paymentMethod === PaymentMethod.UPI_DIRECT
      && order.status === OrderStatus.AWAITING_PAYMENT;
    if (!awaiting || autoPaidPromptedRef.current) return;
    autoPaidPromptedRef.current = true;
    setNotice(t.orderTracking.noticeCompletePayment);
    void openUpi();
  }, [order, placeResult]);

  // Re-prompt: detect the shop clearing a payment claim ("not received"). When
  // the previous poll had an open claim and now it's gone (still AWAITING_PAYMENT),
  // tell the customer to pay again.
  useEffect(() => {
    if (!order) return;
    const awaiting = order.paymentMethod === PaymentMethod.UPI_DIRECT
      && order.status === OrderStatus.AWAITING_PAYMENT;
    const hasClaim = awaiting && !!order.paymentClaimedAt;
    if (hadClaimRef.current && awaiting && !hasClaim) {
      setNotice(t.orderTracking.noticePayAgain);
    }
    hadClaimRef.current = hasClaim;
  }, [order]);

  // Browser notifications on order state changes.
  useEffect(() => {
    if (!order) return;
    const prev = prevOrderRef.current;
    prevOrderRef.current = order;
    if (!prev) return; // first load — don't fire on initial render

    const tag = `passwaala-order-${order.id}`;

    // Payment requested by shop
    if (prev.status !== OrderStatus.AWAITING_PAYMENT && order.status === OrderStatus.AWAITING_PAYMENT) {
      notifyOrderUpdate('💳 Payment Required', `${order.shop.name} is ready — please complete your UPI payment.`, tag);
    }
    // Item(s) removed — order total changed
    const prevUnavail = prev.items.filter(i => i.status === 'UNAVAILABLE').length;
    const nowUnavail = order.items.filter(i => i.status === 'UNAVAILABLE').length;
    if (nowUnavail > prevUnavail && order.status !== OrderStatus.CANCELLED) {
      const removed = nowUnavail - prevUnavail;
      notifyOrderUpdate('⚠️ Items Removed', `${removed} item${removed > 1 ? 's were' : ' was'} marked out of stock by ${order.shop.name}. Tap to review.`, tag);
    }
    // Order cancelled
    if (prev.status !== OrderStatus.CANCELLED && order.status === OrderStatus.CANCELLED) {
      notifyOrderUpdate('❌ Order Cancelled', `Your order from ${order.shop.name} has been cancelled.`, tag);
    }
    // Order accepted
    if (prev.status === OrderStatus.PLACED && order.status === OrderStatus.ACCEPTED) {
      notifyOrderUpdate('✅ Order Accepted', `${order.shop.name} accepted your order and is preparing it.`, tag);
    }
    // Out for delivery
    if (prev.status !== OrderStatus.OUT_FOR_DELIVERY && order.status === OrderStatus.OUT_FOR_DELIVERY) {
      notifyOrderUpdate('🛵 Out for Delivery', `Your order from ${order.shop.name} is on the way!`, tag);
    }
    // Delivered
    if (prev.status !== OrderStatus.DELIVERED && order.status === OrderStatus.DELIVERED) {
      notifyOrderUpdate('🎉 Order Delivered', `Your order from ${order.shop.name} has been delivered. Enjoy!`, tag);
    }
  }, [order]);

  async function confirmPaid() {
    setConfirming(true);
    setNotice(null);
    try {
      await api.confirmPayment(orderId);
      await load();
      setNotice(t.orderTracking.noticePaymentNoted);
    } catch (e) {
      // The shop may not have accepted the order yet; surface a friendly note.
      setNotice((e as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  async function confirmRefundReceived() {
    setRefundBusy(true);
    setNotice(null);
    try {
      await api.confirmRefundReceived(orderId);
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setRefundBusy(false);
    }
  }

  async function openUpi() {
    const link = upiLink();
    if (!link) return;
    try {
      if (Platform.OS === 'web') {
        // Navigate the current tab to the upi: scheme so the OS shows its UPI
        // app picker. window.open(_blank) opens a dead tab and lets some apps
        // (e.g. WhatsApp Pay) hijack the intent — location.href is reliable.
        window.location.href = link;
      } else {
        await Linking.openURL(link);
      }
    } catch {
      setNotice(t.orderTracking.noticeUpiFailed);
    }
  }

  function upiLink(): string | null {
    if (placeResult?.upiDeepLink) return placeResult.upiDeepLink;
    if (order?.shop.upiVpa) {
      const total = order.adjustedTotalPaise ?? order.originalTotalPaise;
      return buildUpiDeepLink(order.shop.upiVpa, order.shop.name, total, `Order ${order.id.slice(0, 8)}`);
    }
    return null;
  }

  async function submitReview() {
    if (!order) return;
    setSubmittingReview(true);
    setNotice(null);
    try {
      await api.createReview({
        orderId: order.id,
        rating: reviewRating,
        comment: reviewComment.trim() || undefined,
      });
      setReviewed(true);
      setShowReview(false);
      setNotice(t.orderTracking.noticeRated);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setSubmittingReview(false);
    }
  }

  if (loading) return <Loading label={t.orderTracking.loadingOrder} />;
  if (error && !order) return <ErrorState message={error} onRetry={load} />;
  if (!order) return <ErrorState message={t.orderTracking.orderNotFound} onRetry={load} />;

  const isTerminalBad = TERMINAL_BAD.has(order.status);
  const total = order.adjustedTotalPaise ?? order.originalTotalPaise;
  const isUpi = order.paymentMethod === PaymentMethod.UPI_DIRECT;
  const isPickup = order.deliveryMode === DeliveryMode.SELF_PICKUP;
  const timeline = timelineFor(order.deliveryMode, t);
  const currentStep = stepIndexFor(order.status, timeline);
  // The assigned rider (PLATFORM_RIDER orders once claimed) — show a call card.
  const rider = order.rider ?? null;
  // Payment UI shows ONLY for UPI orders explicitly awaiting payment AND not yet
  // confirmed. Once the shop verifies (paymentConfirmed) or the order advances,
  // the Pay / QR / "I've paid" block auto-hides. COD never shows payment UI.
  const needsPayment = isUpi && order.status === OrderStatus.AWAITING_PAYMENT && !order.paymentConfirmed;
  // The customer has claimed payment and is waiting for the shop to verify.
  const paymentClaimed = needsPayment && !!order.paymentClaimedAt;
  // The "Rate your order" CTA shows ONLY once the order is delivered.
  const isDelivered = order.status === OrderStatus.DELIVERED;
  // The handoff OTP is shown while the order is still active (not delivered/collected
  // and not terminal). Applies to both delivery and pickup.
  const showHandoffOtp = !!order.pickupOtp && !isDelivered && !isTerminalBad;

  // ---- Live ETA + tracking geometry ----
  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const shopLat = num(order.shop.latitude);
  const shopLng = num(order.shop.longitude);
  const dropLat = num(order.address?.latitude);
  const dropLng = num(order.address?.longitude);
  const riderLat = num(rider?.riderProfile?.latitude);
  const riderLng = num(rider?.riderProfile?.longitude);
  const shopGeo = shopLat != null && shopLng != null ? { lat: shopLat, lng: shopLng } : null;
  const dropGeo = dropLat != null && dropLng != null ? { lat: dropLat, lng: dropLng } : null;
  const riderGeo = riderLat != null && riderLng != null ? { lat: riderLat, lng: riderLng } : null;
  const itemCount = order.items.reduce((n, it) => n + it.qty, 0);
  // Travel distance: once out for delivery and the rider has reported a spot,
  // use rider→drop so the ETA shrinks live; otherwise shop→drop.
  const travelMeters =
    order.status === OrderStatus.OUT_FOR_DELIVERY && riderGeo && dropGeo
      ? haversineMeters(riderGeo, dropGeo)
      : shopGeo && dropGeo
        ? haversineMeters(shopGeo, dropGeo)
        : null;
  const etaBand = formatMinutesBand(
    estimateOrderMinutes({ status: order.status, itemCount, travelMeters }),
  );
  // The leg the rider is on: heading to the shop while RIDER_ASSIGNED, then to
  // the customer once OUT_FOR_DELIVERY.
  const tripPhase = order.status === OrderStatus.OUT_FOR_DELIVERY ? 'to_customer' : 'to_shop';
  // Show the live map for platform-rider orders once a rider is assigned (and
  // has started reporting position) through delivery.
  const showMap =
    order.deliveryMode === DeliveryMode.PLATFORM_RIDER &&
    !!shopGeo &&
    !!dropGeo &&
    (order.status === OrderStatus.RIDER_ASSIGNED || order.status === OrderStatus.OUT_FOR_DELIVERY) &&
    !isTerminalBad &&
    !isDelivered;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {/* Zomato-style green sticky header */}
      <View style={[styles.stickyHeader, isTerminalBad && styles.stickyHeaderBad, isDelivered && styles.stickyHeaderDelivered]}>
        <View style={styles.stickyHeaderTop}>
          <Pressable onPress={onDone} style={styles.stickyBack} hitSlop={8}>
            <Text style={styles.stickyBackText}>←</Text>
          </Pressable>
          <Text style={styles.stickyShopName} numberOfLines={1}>{order.shop.name}</Text>
          <View style={styles.stickyBackPlaceholder} />
        </View>
        <Text style={styles.stickyStatusText}>
          {isTerminalBad
            ? statusLabel(order.status, t)
            : isDelivered
              ? '✅  Order Delivered!'
              : order.status === 'OUT_FOR_DELIVERY'
                ? '🛵  On the way to you'
                : order.status === 'PREPARING' || order.status === 'READY' || order.status === 'RIDER_ASSIGNED'
                  ? '👨‍🍳  Preparing your order'
                  : order.status === 'AWAITING_PAYMENT'
                    ? '💳  Awaiting payment'
                    : '✅  Order Confirmed!'}
        </Text>
        {etaBand && !isTerminalBad && !isDelivered ? (
          <View style={styles.stickyEtaRow}>
            <View style={styles.stickyEtaChip}>
              <Text style={styles.stickyEtaText}>
                {isPickup ? t.orderTracking.readyIn(etaBand) : t.orderTracking.arrivingIn(etaBand)}
              </Text>
              <Text style={styles.stickyEtaDot}> • </Text>
              <Text style={styles.stickyEtaText}>On time</Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* Shop contact card — Zomato style with logo + call button */}
      <View style={styles.shopCard}>
        {order.shop.storefrontPhotoUrl ? (
          <Image source={{ uri: order.shop.storefrontPhotoUrl }} style={styles.shopCardAvatar} />
        ) : (
          <View style={[styles.shopCardAvatar, styles.shopCardAvatarFallback]}>
            <Text style={styles.shopCardAvatarText}>🏬</Text>
          </View>
        )}
        <View style={styles.shopCardInfo}>
          <Text style={styles.shopCardName} numberOfLines={1}>{order.shop.name}</Text>
          {order.shop.addressLine || order.shop.city ? (
            <Text style={styles.shopCardSub} numberOfLines={1}>
              {[order.shop.addressLine, order.shop.city].filter(Boolean).join(', ')}
            </Text>
          ) : null}
          <Text style={styles.shopCardOrderId}>
            Order #{order.shortId ?? `OR${order.id.replace(/-/g,'').slice(0,8).toUpperCase()}`}
          </Text>
        </View>
        {order.shop.contactPhone ? (
          <Pressable
            style={styles.shopCallBtn}
            onPress={() => Linking.openURL(`tel:${order.shop.contactPhone}`)}
            hitSlop={8}
          >
            <Text style={styles.shopCallIcon}>📞</Text>
          </Pressable>
        ) : null}
      </View>

      {/* UPI payment prompt / waiting-for-verification */}
      {needsPayment ? (
        paymentClaimed ? (
          <View style={styles.payCard}>
            <Text style={styles.payTitle}>{t.orderTracking.paymentSent}</Text>
            <Text style={styles.paySub}>
              {t.orderTracking.paymentVerifying(order.shop.name, formatRupees(total))}
            </Text>
          </View>
        ) : (
          <View style={styles.payCard}>
            <Text style={styles.payTitle}>{t.orderTracking.completeUpi}</Text>
            <Text style={styles.payAmount}>{formatRupees(total)}</Text>
            <Text style={styles.paySub}>{t.orderTracking.payDirectly(order.shop.name)}</Text>
            {upiLink() ? (
              <>
                <UpiQr link={upiLink()!} />
                <Button label={t.orderTracking.payNowUpi} onPress={openUpi} icon="📲" />
              </>
            ) : null}
            <Button
              label={t.orderTracking.ivePaid}
              onPress={confirmPaid}
              variant="outline"
              busy={confirming}
            />
          </View>
        )
      ) : null}

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {/* Handoff OTP — shown at pickup/delivery so the shop can confirm the order. */}
      {showHandoffOtp ? (
        <View style={styles.otpCard}>
          <Text style={styles.otpLabel}>{t.orderTracking.otpLabel}</Text>
          <Text style={styles.otpCode}>{order.pickupOtp}</Text>
          <Text style={styles.otpHint}>{t.orderTracking.otpHint}</Text>
        </View>
      ) : null}

      {/* Timeline */}
      {!isTerminalBad ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.orderTracking.orderStatus}</Text>
          {timeline.map((step, i) => {
            // When the order is delivered/collected, every step (including the
            // last) reads as "done" — no node is "active", so the terminal state
            // never shows an "In progress" badge alongside "Delivered".
            const state: 'done' | 'active' | 'todo' = isDelivered
              ? 'done'
              : i < currentStep
                ? 'done'
                : i === currentStep
                  ? 'active'
                  : 'todo';
            const isLast = i === timeline.length - 1;
            return (
              <View key={step.key} style={styles.timelineRow}>
                <View style={styles.timelineGutter}>
                  <View
                    style={[
                      styles.node,
                      state === 'done' && styles.nodeDone,
                      state === 'active' && styles.nodeActive,
                    ]}
                  >
                    <Text style={styles.nodeIcon}>{state === 'todo' ? '' : step.icon}</Text>
                  </View>
                  {!isLast ? (
                    <View style={[styles.connector, (isDelivered || i < currentStep) && styles.connectorDone]} />
                  ) : null}
                </View>
                <View style={styles.timelineBody}>
                  <Text style={[styles.stepLabel, state === 'todo' && styles.stepLabelTodo]}>
                    {step.label}
                  </Text>
                  <Text style={styles.stepCaption}>{step.caption}</Text>
                  {state === 'active' ? <Badge label={t.orderTracking.inProgress} tone="info" style={styles.stepBadge} /> : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.badReason}>
            {order.cancellationReason || order.rejectionReason || t.orderTracking.willNotFulfill}
          </Text>
        </View>
      )}

      {/* Delivery partner — shown once a platform rider has claimed the order,
          hidden once delivered (the trip is over). */}
      {rider && !isTerminalBad && !isDelivered ? (
        <View style={styles.riderCard}>
          <View style={styles.riderAvatar}>
            <Text style={styles.riderAvatarText}>🛵</Text>
          </View>
          <View style={styles.riderInfo}>
            <Text style={styles.riderLabel}>{t.orderTracking.deliveryPartner}</Text>
            <Text style={styles.riderName}>{rider.name || t.orderTracking.rider}</Text>
            <Text style={styles.riderPhone}>{rider.phone}</Text>
          </View>
          <Pressable
            style={styles.callBtn}
            onPress={() => Linking.openURL(`tel:${rider.phone}`)}
            hitSlop={8}
          >
            <Text style={styles.callBtnIcon}>📞</Text>
            <Text style={styles.callBtnText}>{t.orderTracking.call}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Live tracking mini-map (platform-rider orders, once coords are known). */}
      {showMap && shopGeo && dropGeo ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.orderTracking.liveTracking}</Text>
          <TrackingMap shop={shopGeo} drop={dropGeo} rider={riderGeo} phase={tripPhase} />
        </View>
      ) : null}

      {/* Rate your order — only once delivered */}
      {isDelivered ? (
        <View style={styles.rateCard}>
          <Text style={styles.rateEmoji}>⭐</Text>
          {reviewed ? (
            <Text style={styles.rateTitle}>{t.orderTracking.rateThanks}</Text>
          ) : (
            <>
              <Text style={styles.rateTitle}>{t.orderTracking.howWasOrder}</Text>
              <Text style={styles.rateSub}>{t.orderTracking.rateShop(order.shop.name)}</Text>
              <Button label={t.orderTracking.rateYourOrder} onPress={() => setShowReview(true)} icon="⭐" />
            </>
          )}
        </View>
      ) : null}

      {/* Nudge — one-time message to the shop while order is being prepared */}
      {[OrderStatus.PLACED, OrderStatus.ACCEPTED, OrderStatus.AWAITING_PAYMENT, OrderStatus.PREPARING].includes(order.status) ? (
        <View style={styles.nudgeCard}>
          {order.customerNudgedAt ? (
            <View style={styles.nudgeSent}>
              <Text style={styles.nudgeSentIcon}>💬</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.nudgeSentTitle}>Message sent to shop</Text>
                <Text style={styles.nudgeSentBody}>"{order.customerNudge}"</Text>
              </View>
            </View>
          ) : showNudge ? (
            <View style={{ gap: theme.space.sm }}>
              <Text style={styles.nudgeTitle}>Send a message to the shop</Text>
              <View style={styles.nudgePresets}>
                {['Please hurry!', 'Is my order ready?', 'Please add less spice', 'Add extra packaging'].map(p => (
                  <Pressable key={p} style={[styles.nudgePreset, nudgeText === p && styles.nudgePresetActive]} onPress={() => setNudgeText(p)}>
                    <Text style={[styles.nudgePresetText, nudgeText === p && styles.nudgePresetTextActive]}>{p}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={styles.nudgeInput}
                placeholder="Or type a custom message…"
                placeholderTextColor={theme.color.textFaint}
                value={nudgeText}
                onChangeText={setNudgeText}
                maxLength={200}
              />
              <View style={styles.nudgeActions}>
                <Button
                  label="Send message"
                  disabled={!nudgeText.trim() || sendingNudge}
                  busy={sendingNudge}
                  onPress={async () => {
                    if (!nudgeText.trim()) return;
                    setSendingNudge(true);
                    try {
                      await api.sendOrderNudge(order.id, nudgeText.trim());
                      setShowNudge(false);
                      await load();
                    } catch (e) { setError((e as Error).message); }
                    finally { setSendingNudge(false); }
                  }}
                />
                <Button label="Cancel" variant="secondary" onPress={() => { setShowNudge(false); setNudgeText(''); }} />
              </View>
            </View>
          ) : (
            <Pressable style={styles.nudgeBtn} onPress={() => setShowNudge(true)}>
              <Text style={styles.nudgeBtnEmoji}>💬</Text>
              <Text style={styles.nudgeBtnText}>Message the shop</Text>
              <Text style={styles.nudgeBtnArrow}>›</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* Help / dispute — available on any order within the 48h window */}
      <DisputeModal ref={disputeRef} orderId={order.id} orderCreatedAt={order.createdAt} senderRole="CUSTOMER" />

      {/* Refund received ✅ — customer confirmed the off-platform refund */}
      {order.status === OrderStatus.REFUNDED ? (
        <View style={styles.refundDoneCard}>
          <Text style={styles.refundDoneTitle}>✅ Refund confirmed</Text>
          <Text style={styles.refundDoneBody}>
            You confirmed you received your refund of {formatRupees(order.adjustedTotalPaise ?? order.originalTotalPaise)} from {order.shop.name}. This order is now closed.
          </Text>
        </View>
      ) : order.status === OrderStatus.REFUND_PENDING ? (
        <View style={styles.refundCard}>
          <Text style={styles.refundTitle}>💸 Refund pending</Text>
          {/* Audit summary — what happened */}
          <View style={styles.refundAudit}>
            <Text style={styles.refundAuditRow}>
              Order <Text style={styles.refundAuditBold}>#{(order.shortId || order.id.slice(0, 8)).toUpperCase()}</Text> · {formatRupees(order.adjustedTotalPaise ?? order.originalTotalPaise)}
            </Text>
            <Text style={styles.refundAuditRow}>
              Cancelled by <Text style={styles.refundAuditBold}>{cancelledByLabel(order.cancelledBy, order.shop.name)}</Text>
            </Text>
            {order.cancellationReason ? (
              <Text style={styles.refundAuditRow}>Reason: {order.cancellationReason}</Text>
            ) : null}
          </View>
          <Text style={styles.refundBody}>
            {order.shop.name} will refund you directly. Once the money is back with you, confirm below — or raise a dispute if you haven't received it.
          </Text>
          <Button
            label={refundBusy ? 'Confirming…' : '✅ I received my refund'}
            onPress={confirmRefundReceived}
            disabled={refundBusy}
          />
          <Pressable
            style={styles.refundDisputeBtn}
            onPress={() =>
              disputeRef.current?.openWithReason(
                `I have not received my refund of ${formatRupees(order.adjustedTotalPaise ?? order.originalTotalPaise)} for order #${(order.shortId || order.id.slice(0, 8)).toUpperCase()} — ${order.shop.name} cancelled a paid order.`,
              )
            }
            disabled={refundBusy}
          >
            <Text style={styles.refundDisputeBtnText}>I didn't get it — get help</Text>
          </Pressable>
          {order.shop.contactPhone ? (
            <Pressable onPress={() => Linking.openURL(`tel:${order.shop.contactPhone}`)}>
              <Text style={styles.refundCallBtn}>📞 Call {order.shop.name}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Order recap */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.orderTracking.orderSummary}</Text>
        {order.items.some(it => it.status === 'UNAVAILABLE') && order.status !== 'CANCELLED' && order.status !== 'REJECTED' ? (
          <View style={styles.itemsUpdatedBanner}>
            <Text style={styles.itemsUpdatedText}>
              ⚠️ {order.items.filter(it => it.status === 'UNAVAILABLE').length} item{order.items.filter(it => it.status === 'UNAVAILABLE').length > 1 ? 's' : ''} removed by the shop — order total updated.
            </Text>
            {!order.customerAcceptedChanges ? (
              <Button
                label="✓ Accept changes & continue"
                onPress={async () => {
                  try {
                    await api.acceptOrderChanges(order.id);
                    await load();
                  } catch (e) { setError((e as Error).message); }
                }}
              />
            ) : (
              <Text style={[styles.itemsUpdatedText, { color: '#065F46' }]}>✓ You accepted these changes</Text>
            )}
          </View>
        ) : null}
        {order.items.map((it) => {
          const isCancelled = order.status === 'CANCELLED' || order.status === 'REJECTED';
          const unavail = it.status === 'UNAVAILABLE' && !isCancelled;
          return (
            <View key={it.id} style={[styles.recapRow, unavail && { opacity: 0.45 }]}>
              <Text style={styles.recapQty}>{it.qty}×</Text>
              <Text style={[styles.recapName, unavail && styles.recapStrike]} numberOfLines={1}>
                {it.nameSnapshot}{unavail ? ' (unavailable)' : ''}
              </Text>
              <Text style={[styles.recapPrice, unavail && styles.recapStrike]}>{unavail ? '' : formatRupees(it.pricePaiseSnapshot * it.qty)}</Text>
            </View>
          );
        })}
        <Divider style={styles.recapDivider} />
        {/* Itemized bill — same breakdown the shop sees. */}
        <View style={styles.recapRow}>
          <Text style={styles.recapName}>{t.orderTracking.itemsSubtotal}</Text>
          <Text style={styles.recapPrice}>
            {formatRupees(total - order.platformFeePaise - order.deliveryFeePaise)}
          </Text>
        </View>
        <View style={styles.recapRow}>
          <Text style={styles.recapName}>{t.orderTracking.deliveryFee}</Text>
          <Text style={styles.recapPrice}>
            {order.deliveryFeePaise > 0 ? formatRupees(order.deliveryFeePaise) : t.common.free}
          </Text>
        </View>
        <View style={styles.recapRow}>
          <Text style={styles.recapName}>{t.orderTracking.platformFee}</Text>
          <Text style={styles.recapPrice}>{formatRupees(order.platformFeePaise)}</Text>
        </View>
        <Divider style={styles.recapDivider} />
        <View style={styles.recapRow}>
          <Text style={[styles.recapName, styles.recapTotalLabel]}>{t.orderTracking.totalPaid}</Text>
          <Text style={styles.recapTotal}>{formatRupees(total)}</Text>
        </View>
        <View style={styles.payMethodRow}>
          <Badge
            label={isUpi ? t.orderTracking.upiBadge : t.orderTracking.codBadge}
            tone={isUpi ? 'info' : 'neutral'}
          />
          {order.paymentConfirmed ? <Badge label={t.orderTracking.paymentConfirmed} tone="success" /> : null}
        </View>
      </View>

      <View style={styles.doneWrap}>
        <Button label={t.orderTracking.backToOrders} onPress={onDone} variant="secondary" />
      </View>

      <Modal visible={showReview} transparent animationType="fade" onRequestClose={() => setShowReview(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t.orderTracking.rateYourOrder}</Text>
            <Text style={styles.modalSub}>{order.shop.name}</Text>
            <View style={styles.starRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} onPress={() => setReviewRating(n)} hitSlop={6}>
                  <Text style={[styles.starPick, n <= reviewRating && styles.starPickActive]}>
                    {n <= reviewRating ? '★' : '☆'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.reviewInput}
              placeholder={t.orderTracking.reviewCommentPlaceholder}
              placeholderTextColor={theme.color.textFaint}
              value={reviewComment}
              onChangeText={setReviewComment}
              multiline
            />
            <Button label={t.orderTracking.submitRating} onPress={submitReview} busy={submittingReview} />
            <Button label={t.common.cancel} onPress={() => setShowReview(false)} variant="ghost" />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function statusLabel(status: OrderStatus, t: Strings): string {
  switch (status) {
    case OrderStatus.REJECTED:
      return t.orderTracking.statusRejected;
    case OrderStatus.CANCELLED:
      return t.orderTracking.statusCancelled;
    case OrderStatus.REFUND_PENDING:
      return t.orderTracking.statusRefundPending;
    case OrderStatus.REFUNDED:
      return t.orderTracking.statusRefunded;
    default:
      return status;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  scroll: { paddingBottom: theme.space.xxl, gap: theme.space.md },
  // ── Zomato-style sticky green header ──
  stickyHeader: {
    backgroundColor: theme.color.primary,
    paddingTop: 12,
    paddingBottom: theme.space.lg,
    paddingHorizontal: theme.space.lg,
    gap: theme.space.sm,
  },
  stickyHeaderBad: { backgroundColor: theme.color.warning },
  stickyHeaderDelivered: { backgroundColor: theme.color.success },
  stickyHeaderTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stickyBack: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  stickyBackText: { fontSize: 18, fontWeight: '700', color: '#fff' },
  stickyBackPlaceholder: { width: 34 },
  stickyShopName: { flex: 1, fontSize: theme.font.body, fontWeight: '700', color: '#fff', textAlign: 'center' },
  stickyStatusText: { fontSize: theme.font.h2, fontWeight: '800', color: '#fff', textAlign: 'center' },
  stickyEtaRow: { alignItems: 'center' },
  stickyEtaChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.md, paddingVertical: 5,
    alignSelf: 'center',
  },
  stickyEtaText: { fontSize: theme.font.small, fontWeight: '700', color: '#fff' },
  stickyEtaDot: { color: 'rgba(255,255,255,0.6)', fontSize: theme.font.small },

  // ── Shop card (Zomato style) ──
  shopCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    backgroundColor: theme.color.surface,
    marginHorizontal: theme.space.lg,
    marginTop: theme.space.md,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    ...shadow.sm,
  },
  shopCardAvatar: { width: 52, height: 52, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt },
  shopCardAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  shopCardAvatarText: { fontSize: 28 },
  shopCardInfo: { flex: 1, gap: 2 },
  shopCardName: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  shopCardSub: { fontSize: theme.font.small, color: theme.color.textMuted },
  shopCardOrderId: { fontSize: theme.font.tiny, color: theme.color.textFaint, marginTop: 2 },
  shopCallBtn: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 1.5, borderColor: theme.color.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  shopCallIcon: { fontSize: 18 },

  // legacy — kept for any remaining references
  navHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md, backgroundColor: theme.color.bg },
  navBack: { width: 36, height: 36, borderRadius: theme.radius.pill, backgroundColor: theme.color.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border },
  navBackText: { fontSize: 20, fontWeight: '700', color: theme.color.text },
  navTitle: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  navSub: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  refundCard: { marginHorizontal: theme.space.lg, backgroundColor: '#FFF7ED', borderRadius: theme.radius.lg, padding: theme.space.lg, gap: theme.space.sm, borderWidth: 1.5, borderColor: '#FED7AA' },
  refundTitle: { fontSize: theme.font.h3, fontWeight: '800', color: '#92400E' },
  refundBody: { fontSize: theme.font.small, color: '#78350F', lineHeight: 20 },
  refundDetail: { fontSize: theme.font.small, color: theme.color.textMuted },
  refundUpi: { fontWeight: '800', color: theme.color.text },
  refundCallBtn: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.primary, paddingVertical: theme.space.sm },
  refundNote: { fontSize: theme.font.tiny, color: '#92400E', fontStyle: 'italic' },
  refundAudit: { backgroundColor: '#FFFBEB', borderRadius: theme.radius.md, padding: theme.space.md, gap: 3, borderWidth: 1, borderColor: '#FDE68A' },
  refundAuditRow: { fontSize: theme.font.small, color: '#78350F', lineHeight: 19 },
  refundAuditBold: { fontWeight: '800', color: '#92400E' },
  refundDisputeBtn: { alignItems: 'center', paddingVertical: theme.space.sm, borderWidth: 1.5, borderColor: '#B45309', borderRadius: theme.radius.pill },
  refundDisputeBtnText: { fontSize: theme.font.small, fontWeight: '700', color: '#B45309' },
  refundDoneCard: { marginHorizontal: theme.space.lg, backgroundColor: '#ECFDF5', borderRadius: theme.radius.lg, padding: theme.space.lg, gap: theme.space.xs, borderWidth: 1.5, borderColor: '#A7F3D0' },
  refundDoneTitle: { fontSize: theme.font.h3, fontWeight: '800', color: '#065F46' },
  refundDoneBody: { fontSize: theme.font.small, color: '#047857', lineHeight: 20 },
  hero: { backgroundColor: theme.color.primary, alignItems: 'center', paddingVertical: theme.space.xxl, paddingHorizontal: theme.space.lg, gap: theme.space.xs },
  heroBad: { backgroundColor: theme.color.warning },
  heroDelivered: { backgroundColor: theme.color.success },
  heroEmoji: { fontSize: 48 },
  heroTitle: { fontSize: theme.font.h1, fontWeight: '800', color: '#fff' },
  heroSub: { fontSize: theme.font.body, color: '#E6F4EC' },
  heroEta: { fontSize: theme.font.body, color: '#fff', fontWeight: '700', marginTop: theme.space.xs },
  contactCard: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, backgroundColor: theme.color.surface, marginHorizontal: theme.space.lg, borderRadius: theme.radius.lg, padding: theme.space.md, borderWidth: 1, borderColor: theme.color.border, ...shadow.sm },
  contactAvatar: { width: 48, height: 48, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt },
  contactAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  contactAvatarText: { fontSize: 24 },
  contactInfo: { flex: 1, gap: 2 },
  contactName: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  contactSub: { fontSize: theme.font.small, color: theme.color.textMuted },
  contactCallBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: theme.color.primary, alignItems: 'center', justifyContent: 'center' },
  contactCallIcon: { fontSize: 20 },

  payCard: {
    backgroundColor: theme.color.card,
    marginHorizontal: theme.space.lg,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    gap: theme.space.sm,
    borderWidth: 1.5,
    borderColor: theme.color.primary,
    ...shadow.md,
  },
  payTitle: { fontSize: theme.font.h3, fontWeight: "700", color: theme.color.text },
  payAmount: { fontSize: theme.font.hero, fontWeight: "800", color: theme.color.primary },
  paySub: { fontSize: theme.font.small, color: theme.color.textMuted, marginBottom: theme.space.sm },
  payScanHint: { fontSize: theme.font.tiny, color: theme.color.textMuted, textAlign: 'center', marginTop: theme.space.xs, marginBottom: theme.space.xs },

  riderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    backgroundColor: theme.color.primaryLight,
    marginHorizontal: theme.space.lg,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    ...shadow.sm,
  },
  riderAvatar: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  riderAvatarText: { fontSize: 24 },
  riderInfo: { flex: 1, gap: 1 },
  riderLabel: { fontSize: theme.font.tiny, fontWeight: "600", color: theme.color.primaryDark, textTransform: 'uppercase', letterSpacing: 0.4 },
  riderName: { fontSize: theme.font.h3, fontWeight: "700", color: theme.color.text },
  riderPhone: { fontSize: theme.font.small, color: theme.color.textMuted },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  callBtnIcon: { fontSize: 14 },
  callBtnText: { color: theme.color.card, fontWeight: "700", fontSize: theme.font.small },

  otpCard: {
    backgroundColor: theme.color.card,
    marginHorizontal: theme.space.lg,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    gap: theme.space.xs,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: theme.color.primary,
    ...shadow.md,
  },
  otpLabel: { fontSize: theme.font.body, fontWeight: "600", color: theme.color.text, textAlign: 'center' },
  otpCode: {
    fontSize: theme.font.hero,
    fontWeight: "800",
    color: theme.color.primary,
    letterSpacing: 8,
  },
  otpHint: { fontSize: theme.font.small, color: theme.color.textMuted, textAlign: 'center' },

  notice: {
    marginHorizontal: theme.space.lg,
    color: theme.color.info,
    fontSize: theme.font.small,
    textAlign: 'center',
    fontWeight: "500",
  },

  section: {
    backgroundColor: theme.color.card,
    marginHorizontal: theme.space.lg,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    ...shadow.sm,
  },
  sectionTitle: { fontSize: theme.font.h3, fontWeight: "700", color: theme.color.text, marginBottom: theme.space.md },

  timelineRow: { flexDirection: 'row', gap: theme.space.md },
  timelineGutter: { alignItems: 'center', width: 40 },
  node: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.color.border,
  },
  nodeDone: { backgroundColor: theme.color.primaryLight, borderColor: theme.color.primary },
  nodeActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  nodeIcon: { fontSize: 18 },
  connector: { width: 2, flex: 1, minHeight: 24, backgroundColor: theme.color.border, marginVertical: 2 },
  connectorDone: { backgroundColor: theme.color.primary },
  timelineBody: { flex: 1, paddingBottom: theme.space.lg },
  stepLabel: { fontSize: theme.font.body, fontWeight: "700", color: theme.color.text },
  stepLabelTodo: { color: theme.color.textFaint },
  stepCaption: { fontSize: theme.font.small, color: theme.color.textMuted },
  stepBadge: { marginTop: theme.space.xs },

  badReason: { fontSize: theme.font.body, color: theme.color.text },

  recapRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, paddingVertical: 3 },
  recapQty: { fontSize: theme.font.body, fontWeight: "700", color: theme.color.primary, minWidth: 28 },
  recapName: { flex: 1, fontSize: theme.font.body, color: theme.color.text },
  recapPrice: { fontSize: theme.font.body, color: theme.color.text, fontWeight: "500" },
  recapStrike: { textDecorationLine: 'line-through', color: theme.color.textFaint },
  recapDivider: { marginVertical: theme.space.sm },
  itemsUpdatedBanner: { backgroundColor: '#FEF3C7', borderRadius: theme.radius.md, padding: theme.space.sm, borderWidth: 1, borderColor: '#FDE68A', marginBottom: theme.space.sm },
  itemsUpdatedText: { fontSize: theme.font.small, color: '#92400E', fontWeight: '600' },
  recapTotalLabel: { fontWeight: "700" },
  recapTotal: { fontSize: theme.font.h3, fontWeight: "800", color: theme.color.text },
  payMethodRow: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.md, flexWrap: 'wrap' },

  doneWrap: { paddingHorizontal: theme.space.lg },

  rateCard: {
    backgroundColor: theme.color.card,
    marginHorizontal: theme.space.lg,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    gap: theme.space.sm,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: theme.color.accent,
    ...shadow.sm,
  },
  rateEmoji: { fontSize: 40 },
  rateTitle: { fontSize: theme.font.h3, fontWeight: "700", color: theme.color.text, textAlign: 'center' },
  rateSub: { fontSize: theme.font.small, color: theme.color.textMuted, textAlign: 'center', marginBottom: theme.space.sm },

  nudgeCard: { marginHorizontal: theme.space.lg, backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, padding: theme.space.md, ...shadow.sm },
  nudgeBtn: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  nudgeBtnEmoji: { fontSize: 18 },
  nudgeBtnText: { flex: 1, fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  nudgeBtnArrow: { fontSize: 18, color: theme.color.textFaint },
  nudgeTitle: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.text },
  nudgePresets: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs },
  nudgePreset: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.bg },
  nudgePresetActive: { borderColor: theme.color.primary, backgroundColor: theme.color.primaryLight },
  nudgePresetText: { fontSize: theme.font.tiny, fontWeight: '600', color: theme.color.textMuted },
  nudgePresetTextActive: { color: theme.color.primary },
  nudgeInput: { borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md, padding: theme.space.sm, fontSize: theme.font.small, color: theme.color.text, backgroundColor: theme.color.bg },
  nudgeActions: { flexDirection: 'row', gap: theme.space.sm },
  nudgeSent: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm },
  nudgeSentIcon: { fontSize: 20 },
  nudgeSentTitle: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  nudgeSentBody: { fontSize: theme.font.small, color: theme.color.textMuted, fontStyle: 'italic', marginTop: 2 },

  modalBackdrop: { flex: 1, backgroundColor: theme.color.overlay, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },
  modalCard: {
    backgroundColor: theme.color.bg,
    borderRadius: theme.radius.lg,
    padding: theme.space.xl,
    gap: theme.space.sm,
    width: '100%',
    maxWidth: 360,
    alignItems: 'stretch',
  },
  modalTitle: { fontSize: theme.font.h2, fontWeight: "700", color: theme.color.text, textAlign: 'center' },
  modalSub: { fontSize: theme.font.body, color: theme.color.textMuted, textAlign: 'center' },
  starRow: { flexDirection: 'row', justifyContent: 'center', gap: theme.space.xs, marginVertical: theme.space.sm },
  starPick: { fontSize: 36, color: theme.color.borderStrong },
  starPickActive: { color: theme.color.star },
  reviewInput: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    fontSize: theme.font.body,
    color: theme.color.text,
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: theme.space.sm,
  },
});
