import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { OrderStatus, PaymentMethod, DeliveryMode, nextStatuses } from '@passwaala/shared';
import { api } from '../api';
import { onSocket } from '../socket';
import { formatRupees, theme } from '../theme';
import { Badge, Button, ErrorText, OtpBoxes } from '../ui';
import { DisputeModal } from '../components/DisputeModal';
import { actionLabel, orderStatusMeta } from '../status';
import { useLang } from '../i18n/LanguageContext';
import type { Strings } from '../i18n/strings';
import type { FeedOrder } from '../types';

/** How often the open Orders tab refreshes its visible list (ms). */
const POLL_MS = 60000;

/** Orders fetched per page within a tab (initial load + each scroll-to-end). */
const PAGE_SIZE = 20;

/**
 * Filter the shared state machine's next-statuses for the SHOPKEEPER's buttons.
 * UI-only — the state machine allows both edges:
 *  - COD orders skip AWAITING_PAYMENT (ACCEPTED → PREPARING directly); UPI_DIRECT
 *    routes THROUGH it (ACCEPTED → AWAITING_PAYMENT, not straight to PREPARING).
 *  - RIDER_ASSIGNED is a rider-only step, never a shopkeeper button.
 *  - For PLATFORM_RIDER orders the RIDER drives READY → OUT_FOR_DELIVERY →
 *    DELIVERED (via pickup + handoff OTPs), so the shop shows none of those; it
 *    only keeps the REFUND_PENDING dispute path once READY.
 */
function actionsFor(order: FeedOrder): OrderStatus[] {
  const next = nextStatuses(order.status);
  const isCod = order.paymentMethod === PaymentMethod.COD;
  const isRider = order.deliveryMode === DeliveryMode.PLATFORM_RIDER;
  return next.filter((s) => {
    // COD never asks for payment.
    if (isCod && s === OrderStatus.AWAITING_PAYMENT) return false;
    // UPI must be requested payment before preparing: hide the direct
    // ACCEPTED → PREPARING shortcut so the order routes via AWAITING_PAYMENT.
    if (!isCod && order.status === OrderStatus.ACCEPTED && s === OrderStatus.PREPARING) return false;
    // For a UPI order AWAITING_PAYMENT, PREPARING is reached only by VERIFYING
    // the customer's payment claim (dedicated buttons below), never the generic
    // "Start preparing" action.
    if (!isCod && order.status === OrderStatus.AWAITING_PAYMENT && s === OrderStatus.PREPARING) return false;
    // RIDER_ASSIGNED is only ever set by a rider claiming the job.
    if (s === OrderStatus.RIDER_ASSIGNED) return false;
    // Rider-fulfilled orders: the rider handles pickup → out-for-delivery →
    // delivered, so the shop must not advance those itself.
    if (isRider && (s === OrderStatus.OUT_FOR_DELIVERY || s === OrderStatus.DELIVERED)) return false;
    return true;
  });
}

/**
 * OrderFeedScreen — the incoming order queue with state tabs (New / Preparing /
 * Ready / Completed). Each card shows items, total, a status badge, and the
 * next legal actions from the shared state machine. Rejecting opens a reason
 * modal. Pull-to-refresh + a manual refresh button; re-fetches after each
 * mutation so the UI stays server-authoritative.
 */
type TabKey = 'new' | 'preparing' | 'ready' | 'completed';

const TABS: { key: TabKey; statuses: OrderStatus[] }[] = [
  { key: 'new', statuses: [OrderStatus.PLACED, OrderStatus.ACCEPTED, OrderStatus.AWAITING_PAYMENT] },
  { key: 'preparing', statuses: [OrderStatus.PREPARING] },
  { key: 'ready', statuses: [OrderStatus.READY, OrderStatus.RIDER_ASSIGNED, OrderStatus.OUT_FOR_DELIVERY] },
  {
    key: 'completed',
    statuses: [OrderStatus.DELIVERED, OrderStatus.REJECTED, OrderStatus.CANCELLED, OrderStatus.REFUND_PENDING],
  },
];

/** Localized label for a tab key. */
function tabLabel(key: TabKey, t: Strings): string {
  switch (key) {
    case 'new':
      return t.orders.tabNew;
    case 'preparing':
      return t.orders.tabPreparing;
    case 'ready':
      return t.orders.tabReady;
    case 'completed':
      return t.orders.tabCompleted;
  }
}

export function OrderFeedScreen({
  allShops = false,
  advanceOrder: advanceOrderOverride,
  withShopToken,
}: {
  allShops?: boolean;
  advanceOrder?: (orderId: string, shopId: string, status: OrderStatus, reason?: string, otpCode?: string) => Promise<void>;
  withShopToken?: (shopId: string, fn: () => Promise<void>) => Promise<void>;
}) {
  const { t } = useLang();
  const [orders, setOrders] = useState<FeedOrder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('new');
  const [busyId, setBusyId] = useState<string | null>(null);
  // Keyset pagination within the active tab.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0];
  // The active tab's statuses as the comma-separated filter the API expects.
  const statusParam = activeTab.statuses.join(',');

  // Reject-reason modal state.
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Cancel-reason modal state (a cancellation reason is required; it's shown to
  // the customer + surfaced to admins in the disputes view).
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  // Handoff-OTP modal state (moving an order to DELIVERED needs the customer's
  // code). We keep the whole order so the copy can adapt to SELF_PICKUP.
  const [otpTarget, setOtpTarget] = useState<FeedOrder | null>(null);
  const [otp, setOtp] = useState('');
  const otpRef = useRef(''); // always holds the latest value, avoids stale-closure bugs
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);

  // Load page 1 of the active tab (+ refresh the tab-badge counts). Replaces
  // the visible list — used on mount, tab switch, poll, and pull-to-refresh.
  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      setError(null);
      try {
        const [page, freshCounts] = await Promise.all([
          (allShops
            ? api.orderFeedAll(statusParam, { limit: PAGE_SIZE })
            : api.orderFeed(statusParam, { limit: PAGE_SIZE })) as Promise<{
            items: FeedOrder[];
            nextCursor: string | null;
          }>,
          (allShops
            ? api.orderFeedAllCounts()
            : api.orderFeedCounts()) as Promise<Record<string, number>>,
        ]);
        setOrders(page.items);
        setNextCursor(page.nextCursor);
        setCounts(freshCounts);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [statusParam, allShops],
  );

  // Append the next (older) page within the active tab.
  const loadMore = useCallback(async () => {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const page = (await (allShops
        ? api.orderFeedAll(statusParam, { limit: PAGE_SIZE, cursor: nextCursor })
        : api.orderFeed(statusParam, { limit: PAGE_SIZE, cursor: nextCursor }))) as { items: FeedOrder[]; nextCursor: string | null };
      setOrders((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      // Keep what's loaded; the next scroll retries.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor, statusParam, allShops]);

  // Reload page 1 whenever the tab changes (load identity depends on statusParam).
  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Keep the visible page fresh. Socket events (order.created / order.shopUpdated)
  // are the primary trigger; the interval is a slow fallback for when the socket
  // is down.
  useEffect(() => {
    const id = setInterval(() => load(), POLL_MS);
    const off1 = onSocket('order.created', () => { void load(); });
    const off2 = onSocket('order.shopUpdated', () => { void load(); });
    return () => { clearInterval(id); off1(); off2(); };
  }, [load]);

  // Per-tab badge counts derived from the server's per-status counts.
  const tabCounts = useMemo(() => {
    const map: Record<TabKey, number> = { new: 0, preparing: 0, ready: 0, completed: 0 };
    for (const t of TABS) {
      map[t.key] = t.statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
    }
    return map;
  }, [counts]);

  async function advance(orderId: string, shopId: string, status: OrderStatus, reason?: string, otpCode?: string) {
    setBusyId(orderId);
    setError(null);
    // Optimistic: move the order to the new status in the local list right away so
    // the card reflects the transition instantly. On success we reload from the
    // server (authoritative); on failure we restore the prior list + show an error.
    const prevOrders = orders;
    setOrders((list) => list.map((o) => (o.id === orderId ? { ...o, status } : o)));
    try {
      if (advanceOrderOverride) {
        await advanceOrderOverride(orderId, shopId, status, reason, otpCode);
      } else {
        await api.advanceOrder(orderId, status, reason, otpCode);
      }
      await load();
    } catch (e) {
      setOrders(prevOrders); // rollback
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function onAction(orderId: string, status: OrderStatus) {
    const order = orders.find((o) => o.id === orderId);
    const shopId = order?.shopId ?? '';
    if (status === OrderStatus.REJECTED) {
      setRejectTarget(orderId);
      setRejectReason('');
      return;
    }
    if (status === OrderStatus.CANCELLED) {
      setCancelTarget(orderId);
      setCancelReason('');
      return;
    }
    if (status === OrderStatus.DELIVERED) {
      if (order?.pickupOtp) {
        setOtpTarget(order);
        setOtp('');
        otpRef.current = '';
        setOtpError(null);
        return;
      }
      advance(orderId, shopId, status);
      return;
    }
    advance(orderId, shopId, status);
  }

  async function confirmReject() {
    if (!rejectTarget) return;
    const id = rejectTarget;
    const shopId = orders.find((o) => o.id === id)?.shopId ?? '';
    const reason = rejectReason.trim() || 'Out of stock';
    setRejectTarget(null);
    await advance(id, shopId, OrderStatus.REJECTED, reason);
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (!reason) return;
    const id = cancelTarget;
    const shopId = orders.find((o) => o.id === id)?.shopId ?? '';
    setCancelTarget(null);
    await advance(id, shopId, OrderStatus.CANCELLED, reason);
  }

  /** Shopkeeper verifies a customer's payment claim → order moves to PREPARING. */
  async function verifyPayment(orderId: string) {
    const shopId = orders.find((o) => o.id === orderId)?.shopId ?? '';
    setBusyId(orderId);
    setError(null);
    try {
      const run = () => api.shopConfirmPayment(orderId).then(() => undefined);
      await (withShopToken ? withShopToken(shopId, run) : run());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  /** Shopkeeper rejects a payment claim (not received) → customer re-prompted. */
  async function rejectPayment(orderId: string) {
    const shopId = orders.find((o) => o.id === orderId)?.shopId ?? '';
    setBusyId(orderId);
    setError(null);
    try {
      const run = () => api.shopRejectPayment(orderId).then(() => undefined);
      await (withShopToken ? withShopToken(shopId, run) : run());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  /** Shopkeeper confirms a rider's COD-by-UPI claim (money received at the door). */
  async function confirmCodUpi(orderId: string) {
    const shopId = orders.find((o) => o.id === orderId)?.shopId ?? '';
    setBusyId(orderId);
    setError(null);
    try {
      const run = () => api.shopConfirmCodUpi(orderId).then(() => undefined);
      await (withShopToken ? withShopToken(shopId, run) : run());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  /** Shopkeeper says the rider's COD-by-UPI claim was NOT received → clears it. */
  async function rejectCodUpi(orderId: string) {
    const shopId = orders.find((o) => o.id === orderId)?.shopId ?? '';
    setBusyId(orderId);
    setError(null);
    try {
      const run = () => api.shopRejectCodUpi(orderId).then(() => undefined);
      await (withShopToken ? withShopToken(shopId, run) : run());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Confirm the handoff OTP for a DELIVERED transition. Keeps the modal open on
   * a bad code (backend replies 400 with a message) so the shopkeeper can retry.
   */
  async function confirmOtp(codeOverride?: string) {
    if (!otpTarget) return;
    // Always read from the ref so we never get stale React state — the ref is
    // updated synchronously in the onChange handler.
    const raw = (codeOverride ?? otpRef.current).replace(/\D/g, '');
    const code = raw.slice(-4);
    if (code.length < 4) {
      setOtpError(t.orders.enterOtp);
      return;
    }
    setOtpBusy(true);
    setOtpError(null);
    try {
      if (advanceOrderOverride) {
        await advanceOrderOverride(otpTarget.id, otpTarget.shopId, OrderStatus.DELIVERED, undefined, code);
      } else {
        await api.advanceOrder(otpTarget.id, OrderStatus.DELIVERED, undefined, code);
      }
      setOtpTarget(null);
      setOtp('');
      otpRef.current = '';
      await load();
    } catch (e) {
      setOtpError((e as Error).message || t.orders.otpIncorrect);
    } finally {
      setOtpBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.color.accent} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Tabs + refresh */}
      <View style={styles.tabBar}>
        <View style={styles.tabs}>
          {TABS.map((tabItem) => (
            <Pressable
              key={tabItem.key}
              onPress={() => setTab(tabItem.key)}
              style={[styles.tab, tabItem.key === tab && styles.tabActive]}
            >
              <Text style={[styles.tabText, tabItem.key === tab && styles.tabTextActive]}>
                {tabLabel(tabItem.key, t)}
                {tabCounts[tabItem.key] ? ` (${tabCounts[tabItem.key]})` : ''}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => load(true)} style={styles.refreshBtn} disabled={refreshing}>
          <Text style={styles.refreshText}>{refreshing ? '…' : '↻'}</Text>
        </Pressable>
      </View>

      {error ? <View style={styles.errorWrap}><ErrorText>{error}</ErrorText></View> : null}

      <FlatList
        contentContainerStyle={styles.list}
        data={orders}
        keyExtractor={(o) => o.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.color.accent} />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={<Text style={styles.empty}>{t.orders.empty(tabLabel(activeTab.key, t))}</Text>}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={styles.footer} color={theme.color.accent} /> : null
        }
        renderItem={({ item }) => (
          <OrderCard
            order={item}
            busy={busyId === item.id}
            t={t}
            onAction={(status) => onAction(item.id, status)}
            onVerifyPayment={() => verifyPayment(item.id)}
            onRejectPayment={() => rejectPayment(item.id)}
            onConfirmCodUpi={() => confirmCodUpi(item.id)}
            onRejectCodUpi={() => rejectCodUpi(item.id)}
            withShopToken={withShopToken}
            onRefresh={() => load(true)}
          />
        )}
      />

      {/* Reject reason modal — radio buttons like the reference design */}
      <Modal visible={rejectTarget !== null} transparent animationType="fade" onRequestClose={() => setRejectTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t.orders.rejectTitle}</Text>
              <Pressable onPress={() => setRejectTarget(null)} hitSlop={8}><Text style={styles.modalClose}>✕</Text></Pressable>
            </View>
            <Text style={styles.modalSub}>{t.orders.rejectSub}</Text>
            {['Out of stock', 'Delivery not available', 'Store is temporarily closed', 'Customer requested cancellation', 'Other'].map((reason) => (
              <Pressable key={reason} style={styles.radioRow} onPress={() => setRejectReason(reason)}>
                <View style={[styles.radioOuter, rejectReason === reason && styles.radioOuterActive]}>
                  {rejectReason === reason && <View style={styles.radioInner} />}
                </View>
                <Text style={styles.radioLabel}>{reason}</Text>
              </Pressable>
            ))}
            <Button
              label={t.orders.rejectOrder}
              variant="danger"
              disabled={!rejectReason}
              onPress={confirmReject}
              style={{ marginTop: theme.space.md }}
            />
          </View>
        </View>
      </Modal>

      {/* Cancel reason modal */}
      <Modal visible={cancelTarget !== null} transparent animationType="fade" onRequestClose={() => setCancelTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t.orders.cancelTitle}</Text>
              <Pressable onPress={() => setCancelTarget(null)} hitSlop={8}><Text style={styles.modalClose}>✕</Text></Pressable>
            </View>
            <Text style={styles.modalSub}>{t.orders.cancelSub}</Text>
            {['Product is out of stock', 'Delivery address not serviceable', 'Store is temporarily closed', 'Customer requested to cancel the order', 'Other reasons'].map((reason) => (
              <Pressable key={reason} style={styles.radioRow} onPress={() => setCancelReason(reason)}>
                <View style={[styles.radioOuter, cancelReason === reason && styles.radioOuterActive]}>
                  {cancelReason === reason && <View style={styles.radioInner} />}
                </View>
                <Text style={styles.radioLabel}>{reason}</Text>
              </Pressable>
            ))}
            <Button
              label={t.orders.cancelOrder}
              variant="danger"
              disabled={!cancelReason}
              onPress={confirmCancel}
              style={{ marginTop: theme.space.md }}
            />
          </View>
        </View>
      </Modal>

      {/* Handoff OTP modal — required to mark an order DELIVERED / collected. */}
      <Modal visible={otpTarget !== null} transparent animationType="fade" onRequestClose={() => setOtpTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {(() => {
              const isPickup = otpTarget?.deliveryMode === DeliveryMode.SELF_PICKUP;
              return (
                <>
                  <Text style={styles.modalTitle}>{isPickup ? t.orders.markCollected : t.orders.markDelivered}</Text>
                  <Text style={styles.modalSub}>
                    {isPickup ? t.orders.enterPickupCode : t.orders.enterDeliveryCode}
                  </Text>
                </>
              );
            })()}
            <OtpBoxes
              value={otp}
              onChange={(val) => { const v = val.slice(0, 4); otpRef.current = v; setOtp(v); }}
              onComplete={(code) => confirmOtp(code)}
              length={4}
            />
            {otpError ? <ErrorText>{otpError}</ErrorText> : null}
            <View style={styles.modalActions}>
              <Button label={t.common.cancel} variant="ghost" small onPress={() => setOtpTarget(null)} style={{ flex: 1 }} />
              <Button
                label={t.orders.confirm}
                variant="accent"
                small
                busy={otpBusy}
                onPress={confirmOtp}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function OrderCard({
  order,
  busy,
  t,
  onAction,
  onVerifyPayment,
  onRejectPayment,
  onConfirmCodUpi,
  onRejectCodUpi,
  withShopToken,
  onRefresh,
}: {
  order: FeedOrder;
  busy: boolean;
  t: Strings;
  onAction: (status: OrderStatus) => void;
  onVerifyPayment: () => void;
  onRejectPayment: () => void;
  onConfirmCodUpi: () => void;
  onRejectCodUpi: () => void;
  withShopToken?: (shopId: string, fn: () => Promise<void>) => Promise<void>;
  onRefresh?: () => void;
}) {
  const total = order.adjustedTotalPaise ?? order.originalTotalPaise;
  const actions = actionsFor(order);
  const meta = orderStatusMeta(order.status, t);
  const shortId = order.shortId ?? `OR${order.id.replace(/-/g,'').slice(0,8).toUpperCase()}`;
  const when = new Date(order.createdAt).toLocaleString();
  const itemsSubtotal = total - order.platformFeePaise - order.deliveryFeePaise;
  const isUpi = order.paymentMethod === PaymentMethod.UPI_DIRECT;
  const awaitingPayment = isUpi && order.status === OrderStatus.AWAITING_PAYMENT;
  const hasClaim = awaitingPayment && !!order.paymentClaimedAt;
  const codUpiToConfirm =
    order.deliveryMode === DeliveryMode.PLATFORM_RIDER &&
    order.paymentMethod === PaymentMethod.COD &&
    !!order.codUpiClaimedAt &&
    !order.paymentConfirmed;

  // Item availability — only for PLACED/ACCEPTED orders before payment
  const canMarkItems = order.status === OrderStatus.PLACED || order.status === OrderStatus.ACCEPTED;
  const [unavailableIds, setUnavailableIds] = useState<Set<string>>(
    new Set(order.items.filter(it => it.status === 'UNAVAILABLE').map(it => it.id))
  );
  const [markingItems, setMarkingItems] = useState(false);

  function toggleItem(id: string) {
    setUnavailableIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submitUnavailable() {
    if (unavailableIds.size === 0) return;
    setMarkingItems(true);
    const shopId = order.shopId ?? '';
    const run = async () => {
      await api.markOrderItemsUnavailable(order.id, [...unavailableIds]);
    };
    try {
      await (withShopToken && shopId ? withShopToken(shopId, run) : run());
      onRefresh?.();
    } catch { /* ignore */ }
    finally { setMarkingItems(false); }
  }

  return (
    <View style={[styles.card, theme.shadow.sm]}>
      <View style={styles.cardHeader}>
        <View>
          {(order.shop?.name ?? order.shopName) ? <Text style={styles.shopNameLabel}>{order.shop?.name ?? order.shopName}</Text> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.orderId}>#{shortId}</Text>
            {order.bulkOrderId ? (
              <View style={styles.bulkBadge}>
                <Text style={styles.bulkBadgeText}>BULK</Text>
              </View>
            ) : null}
          </View>
          {order.bulkOrderId ? (
            <Text style={styles.bulkRefText}>Multi-shop order</Text>
          ) : null}
          <Text style={styles.orderMeta}>{when} · {order.paymentMethod}</Text>
        </View>
        <Badge label={meta.label} tone={meta.tone} />
      </View>

      <View style={styles.items}>
        {canMarkItems && (
          <Text style={styles.itemAvailHint}>Uncheck items that are out of stock</Text>
        )}
        {order.items.map((it) => {
          const isUnavail = unavailableIds.has(it.id) || it.status === 'UNAVAILABLE';
          return (
            <Pressable
              key={it.id}
              style={[styles.itemRow, canMarkItems && styles.itemRowCheckable]}
              onPress={() => canMarkItems && toggleItem(it.id)}
              disabled={!canMarkItems}
            >
              {canMarkItems && (
                <View style={[styles.itemCheck, !isUnavail && styles.itemCheckActive]}>
                  {!isUnavail && <Text style={styles.itemCheckTick}>✓</Text>}
                </View>
              )}
              <Text style={[styles.itemQty, isUnavail && styles.itemStrike]}>{it.qty}×</Text>
              <Text style={[styles.itemName, isUnavail && styles.itemStrike]} numberOfLines={1}>{it.nameSnapshot}</Text>
              <Text style={[styles.itemPrice, isUnavail && styles.itemStrike]}>{formatRupees(it.pricePaiseSnapshot * it.qty)}</Text>
              {isUnavail && <Text style={styles.itemUnavailBadge}>Out of stock</Text>}
            </Pressable>
          );
        })}
        {canMarkItems && unavailableIds.size > 0 && (
          <Button
            label={markingItems ? 'Notifying customer…' : `Mark ${unavailableIds.size} item${unavailableIds.size > 1 ? 's' : ''} unavailable & notify`}
            variant="outline"
            small
            busy={markingItems}
            onPress={submitUnavailable}
            style={{ marginTop: theme.space.sm }}
          />
        )}
      </View>

      <View style={styles.breakdown}>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>{t.orders.itemsSubtotal}</Text>
          <Text style={styles.breakdownValue}>{formatRupees(itemsSubtotal)}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>{t.orders.deliveryFee}</Text>
          <Text style={styles.breakdownValue}>{formatRupees(order.deliveryFeePaise)}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>{t.orders.platformFee}</Text>
          <Text style={styles.breakdownValue}>{formatRupees(order.platformFeePaise)}</Text>
        </View>
      </View>

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>{t.orders.orderTotal}</Text>
        <Text style={styles.totalValue}>{formatRupees(total)}</Text>
      </View>

      {/* Rider pickup handshake: when a platform rider has claimed the order and
          is coming to collect it, show the pickup code to read out to them. */}
      {order.deliveryMode === DeliveryMode.PLATFORM_RIDER &&
      order.status === OrderStatus.RIDER_ASSIGNED &&
      order.riderPickupOtp ? (
        <View style={styles.pickupCodeBox}>
          <Text style={styles.pickupCodeLabel}>{t.orders.riderPickupCode}</Text>
          <Text style={styles.pickupCodeValue}>{order.riderPickupOtp}</Text>
        </View>
      ) : null}

      {/* Assigned rider — name + tappable phone, once a rider has claimed it. */}
      {order.deliveryMode === DeliveryMode.PLATFORM_RIDER && order.rider ? (
        <Pressable
          style={styles.riderRow}
          onPress={() => order.rider?.phone && Linking.openURL(`tel:${order.rider.phone}`)}
        >
          <View style={styles.riderInfo}>
            <Text style={styles.riderLabel}>{t.orders.deliveryPartner}</Text>
            <Text style={styles.riderName}>
              {order.rider.name || t.orders.rider} · {order.rider.phone}
            </Text>
          </View>
        </Pressable>
      ) : null}

      {/* UPI payment verification: the customer pays the shop directly, so the
          shop confirms receipt. With an open claim, verify or reject it; without
          one, wait for the customer to pay. */}
      {awaitingPayment ? (
        <View style={styles.payVerifyBox}>
          {hasClaim ? (
            <>
              <Text style={styles.payVerifyTitle}>
                {t.orders.customerMarkedPaid}{order.paymentClaimCount && order.paymentClaimCount > 1 ? t.orders.customerMarkedPaidAttempt(order.paymentClaimCount) : ''}
              </Text>
              <Text style={styles.payVerifyHint}>
                {t.orders.checkUpiThenConfirm(formatRupees(total))}
              </Text>
              {busy ? (
                <ActivityIndicator color={theme.color.accent} />
              ) : (
                <View style={styles.actions}>
                  <Button label={t.orders.paymentReceived} small variant="accent" onPress={onVerifyPayment} />
                  <Button label={t.orders.notReceived} small variant="danger" onPress={onRejectPayment} />
                </View>
              )}
            </>
          ) : (
            <Text style={styles.payVerifyHint}>{t.orders.waitingForPayment(formatRupees(total))}</Text>
          )}
        </View>
      ) : null}

      {/* Customer nudge — one-time message from the customer */}
      {order.customerNudge ? (
        <View style={styles.nudgeBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.nudgeBannerTitle}>Message from customer</Text>
            <Text style={styles.nudgeBannerBody}>"{order.customerNudge}"</Text>
          </View>
        </View>
      ) : null}

      {/* COD-by-QR: the rider says the customer paid our UPI at the door. Confirm
          receipt so the rider can mark the order delivered (or reject it). */}
      {codUpiToConfirm ? (
        <View style={styles.payVerifyBox}>
          <Text style={styles.payVerifyTitle}>{t.orders.riderSaysPaid}</Text>
          <Text style={styles.payVerifyHint}>
            {t.orders.riderSaysPaidHint(formatRupees(total))}
          </Text>
          {busy ? (
            <ActivityIndicator color={theme.color.accent} />
          ) : (
            <View style={styles.actions}>
              <Button label={t.orders.paymentReceived} small variant="accent" onPress={onConfirmCodUpi} />
              <Button label={t.orders.notReceived} small variant="danger" onPress={onRejectCodUpi} />
            </View>
          )}
        </View>
      ) : null}

      {actions.length > 0 ? (
        <View style={styles.actions}>
          {/* advance() is optimistic — the card updates status (and usually leaves
              this tab) instantly, so no spinner. `busy` stays only as a double-tap
              guard so the same action can't fire twice mid-request. */}
          {actions.map((next) => (
            <Button
              key={next}
              label={
                next === OrderStatus.DELIVERED
                  ? order.deliveryMode === DeliveryMode.SELF_PICKUP
                    ? t.orders.markCollected
                    : t.orders.markDelivered
                  : actionLabel(next, t)
              }
              small
              variant={next === OrderStatus.REJECTED || next === OrderStatus.CANCELLED ? 'danger' : 'accent'}
              disabled={busy}
              onPress={() => onAction(next)}
            />
          ))}
        </View>
      ) : null}
      <DisputeModal orderId={order.id} orderCreatedAt={order.createdAt} senderRole="SHOP" inline={true} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.md,
  },
  tabs: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.pill,
    padding: 3,
  },
  tab: { flex: 1, paddingVertical: theme.space.sm, borderRadius: theme.radius.pill, alignItems: 'center' },
  tabActive: { backgroundColor: theme.color.surface, ...theme.shadow.sm },
  tabText: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textMuted },
  tabTextActive: { color: theme.color.accent },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshText: { fontSize: 18, color: theme.color.accent, fontWeight: '700' },

  errorWrap: { paddingHorizontal: theme.space.lg, paddingTop: theme.space.sm },
  list: { padding: theme.space.lg, gap: theme.space.md },
  footer: { paddingVertical: theme.space.lg },

  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    gap: theme.space.md,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  shopNameLabel: { fontSize: theme.font.tiny, fontWeight: '800', color: theme.color.accent, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  bulkBadge: { backgroundColor: '#7C3AED', borderRadius: theme.radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  bulkBadgeText: { color: '#FFFFFF', fontSize: theme.font.tiny, fontWeight: '800', letterSpacing: 0.5 },
  bulkRefText: { fontSize: theme.font.tiny, color: '#7C3AED', fontWeight: '600', marginBottom: 2 },
  orderId: { fontWeight: '900', fontSize: theme.font.body, color: theme.color.text },
  orderMeta: { fontSize: theme.font.tiny, color: theme.color.textMuted, marginTop: 2 },

  items: { gap: theme.space.xs },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  itemRowCheckable: { paddingVertical: 4 },
  itemCheck: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: theme.color.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surfaceAlt },
  itemCheckActive: { borderColor: theme.color.accent, backgroundColor: theme.color.accent },
  itemCheckTick: { color: '#fff', fontSize: 11, fontWeight: '900', lineHeight: 13 },
  itemAvailHint: { fontSize: theme.font.tiny, color: theme.color.textMuted, marginBottom: 4 },
  itemStrike: { textDecorationLine: 'line-through', opacity: 0.4 },
  itemUnavailBadge: { fontSize: theme.font.tiny, color: theme.color.danger, fontWeight: '700', backgroundColor: '#FEE2E2', paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.pill },
  itemQty: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.accent, minWidth: 28 },
  itemName: { flex: 1, fontSize: theme.font.small, color: theme.color.text },
  itemPrice: { fontSize: theme.font.small, color: theme.color.textMuted },

  breakdown: {
    gap: theme.space.xs,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingTop: theme.space.sm,
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  breakdownLabel: { fontSize: theme.font.small, color: theme.color.textMuted },
  breakdownValue: { fontSize: theme.font.small, color: theme.color.text, fontWeight: '600' },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingTop: theme.space.sm,
  },
  totalLabel: { fontSize: theme.font.small, color: theme.color.textMuted },
  totalValue: { fontSize: theme.font.h3, fontWeight: '900', color: theme.color.text },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },

  pickupCodeBox: {
    backgroundColor: theme.color.accentSoft,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.accent,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
    alignItems: 'center',
    gap: 2,
  },
  nudgeBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm, backgroundColor: '#EEF2FF', borderRadius: theme.radius.md, padding: theme.space.md, borderWidth: 1, borderColor: '#C7D2FE' },
  nudgeBannerTitle: { fontSize: theme.font.tiny, fontWeight: '800', color: '#4338CA' },
  nudgeBannerBody: { fontSize: theme.font.small, color: '#374151', fontStyle: 'italic', marginTop: 2 },

  payVerifyBox: {
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.md,
    gap: theme.space.xs,
  },
  payVerifyTitle: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.text },
  payVerifyHint: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  pickupCodeLabel: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.accentDark },
  pickupCodeValue: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.accentDark, letterSpacing: 8 },

  riderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
  },
  riderInfo: { flex: 1, gap: 1 },
  riderLabel: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  riderName: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.text },

  empty: { color: theme.color.textMuted, textAlign: 'center', marginTop: theme.space.xxl },

  modalOverlay: { flex: 1, backgroundColor: theme.color.overlay, justifyContent: 'center', padding: theme.space.xl },
  modalCard: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, padding: theme.space.lg, gap: theme.space.sm, width: '100%', maxWidth: theme.maxContentWidth, alignSelf: 'center' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalClose: { fontSize: 18, color: theme.color.textMuted, padding: 4 },
  modalTitle: { fontSize: theme.font.h3, fontWeight: '900', color: theme.color.text },
  modalSub: { fontSize: theme.font.small, color: theme.color.textMuted },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingVertical: theme.space.sm, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  radioOuter: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: theme.color.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radioOuterActive: { borderColor: theme.color.accent },
  radioInner: { width: 11, height: 11, borderRadius: 6, backgroundColor: theme.color.accent },
  radioLabel: { flex: 1, fontSize: theme.font.body, color: theme.color.text },
  modalInput: {
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    fontSize: theme.font.body,
    color: theme.color.text,
    minHeight: 72,
    textAlignVertical: 'top',
    marginTop: theme.space.xs,
  },
  otpInput: {
    minHeight: 56,
    textAlign: 'center',
    fontSize: theme.font.h2,
    fontWeight: '900',
    letterSpacing: 12,
  },
  modalActions: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.sm },
});
