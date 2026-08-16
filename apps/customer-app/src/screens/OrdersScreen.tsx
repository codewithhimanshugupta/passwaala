import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { OrderStatus } from '@passwaala/shared';
import { api } from '../api';
import { getPrefetchedOrders } from '../ordersPrefetch';
import { loadFromServer } from '../cart';
import type { OrderHistoryItem, BulkOrderSummary } from '../types';
import { formatRupees, shadow, theme } from '../theme';
import { Badge, Button, EmptyState, ErrorState, SkeletonBlock } from '../ui';
import { useLang } from '../i18n/LanguageContext';
import type { Strings } from '../i18n/strings';
import { BulkOrderDetailScreen } from './BulkOrderDetailScreen';

/** Ongoing = one fast call (live orders are few). History/Bulk = 5-per-page. */
const ONGOING_LIMIT = 50;
const HISTORY_PAGE = 5;
const BULK_PAGE = 5;

const BULK_PURPLE = '#7C3AED';
const BULK_PURPLE_LIGHT = '#EDE9FE';

type ActiveTab = 'ongoing' | 'history' | 'bulk';

export function OrdersScreen({
  onOpenOrder,
  onReordered,
  onBrowse,
}: {
  onOpenOrder: (orderId: string) => void;
  onReordered: () => void;
  onBrowse: () => void;
}) {
  const { t } = useLang();
  const [activeTab, setActiveTab] = useState<ActiveTab>('ongoing');
  const [reordering, setReordering] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Seed from the app-open prefetch so the screen renders instantly (no skeletons)
  // when data is already warm. Null → cold open, fall back to on-mount fetch.
  const prefetched = getPrefetchedOrders();

  // Ongoing (live) orders — one fast dedicated call, auto-loaded on app open.
  const [ongoing, setOngoing] = useState<OrderHistoryItem[]>(prefetched?.ongoing ?? []);
  const [ongoingLoading, setOngoingLoading] = useState(!prefetched);
  const [ongoingError, setOngoingError] = useState<string | null>(null);

  // History (terminal) orders — 5-per-page, lazy on first tab open, scroll auto-load.
  const [history, setHistory] = useState<OrderHistoryItem[]>(prefetched?.history ?? []);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(!!prefetched);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(prefetched?.historyCursor ?? null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);

  // Bulk orders — 5-per-page, lazy on first tab open.
  const [bulkOrders, setBulkOrders] = useState<BulkOrderSummary[]>(prefetched?.bulk ?? []);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkLoaded, setBulkLoaded] = useState(!!prefetched);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkNextCursor, setBulkNextCursor] = useState<string | null>(prefetched?.bulkCursor ?? null);
  const [bulkLoadingMore, setBulkLoadingMore] = useState(false);

  // Inline bulk detail navigation
  const [openBulkOrderId, setOpenBulkOrderId] = useState<string | null>(null);

  // ── Ongoing ── single call, only live orders (fast). Silent refresh = no flicker.
  const loadOngoing = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setOngoingLoading(true);
    setOngoingError(null);
    try {
      const page = (await api.orderHistory({ limit: ONGOING_LIMIT, mode: 'ongoing' })) as {
        items: OrderHistoryItem[];
        nextCursor: string | null;
      };
      setOngoing(page.items);
    } catch (e) {
      setOngoingError((e as Error).message);
    } finally {
      if (!opts?.silent) setOngoingLoading(false);
    }
  }, []);

  // ── History ── first page (terminal orders only), 5 per page.
  const loadHistory = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setHistoryLoading(true);
    setHistoryError(null);
    try {
      const page = (await api.orderHistory({ limit: HISTORY_PAGE, mode: 'history' })) as {
        items: OrderHistoryItem[];
        nextCursor: string | null;
      };
      setHistory(page.items);
      setHistoryCursor(page.nextCursor);
    } catch (e) {
      setHistoryError((e as Error).message);
    } finally {
      if (!opts?.silent) setHistoryLoading(false);
    }
  }, []);

  const loadMoreHistory = useCallback(async () => {
    if (historyLoadingMore || !historyCursor) return;
    setHistoryLoadingMore(true);
    try {
      const page = (await api.orderHistory({ limit: HISTORY_PAGE, cursor: historyCursor, mode: 'history' })) as {
        items: OrderHistoryItem[];
        nextCursor: string | null;
      };
      setHistory((prev) => [...prev, ...page.items]);
      setHistoryCursor(page.nextCursor);
    } catch {
      // Keep what's loaded; the next scroll retries.
    } finally {
      setHistoryLoadingMore(false);
    }
  }, [historyLoadingMore, historyCursor]);

  // ── Bulk ── first page, 5 per page.
  const loadBulk = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setBulkLoading(true);
    setBulkError(null);
    try {
      const page = (await api.bulkOrderHistory({ limit: BULK_PAGE })) as {
        items: BulkOrderSummary[];
        nextCursor: string | null;
      };
      setBulkOrders(page.items);
      setBulkNextCursor(page.nextCursor);
    } catch (e) {
      setBulkError((e as Error).message);
    } finally {
      if (!opts?.silent) setBulkLoading(false);
    }
  }, []);

  const loadMoreBulk = useCallback(async () => {
    if (bulkLoadingMore || !bulkNextCursor) return;
    setBulkLoadingMore(true);
    try {
      const page = (await api.bulkOrderHistory({ limit: BULK_PAGE, cursor: bulkNextCursor })) as {
        items: BulkOrderSummary[];
        nextCursor: string | null;
      };
      setBulkOrders((prev) => [...prev, ...page.items]);
      setBulkNextCursor(page.nextCursor);
    } catch {
      // Keep what's loaded; the next scroll retries.
    } finally {
      setBulkLoadingMore(false);
    }
  }, [bulkLoadingMore, bulkNextCursor]);

  // Auto-load ongoing the moment the screen opens. When prefetched, refresh
  // silently so the warm list stays on screen (no skeleton flash).
  useEffect(() => {
    void loadOngoing({ silent: !!prefetched });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadOngoing]);

  // Lazy-load history / bulk only when their tab is first activated.
  useEffect(() => {
    if (activeTab === 'history' && !historyLoaded) {
      setHistoryLoaded(true);
      void loadHistory();
    }
    if (activeTab === 'bulk' && !bulkLoaded) {
      setBulkLoaded(true);
      void loadBulk();
    }
  }, [activeTab, historyLoaded, bulkLoaded, loadHistory, loadBulk]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (activeTab === 'ongoing') await loadOngoing({ silent: true });
      else if (activeTab === 'history') { setHistoryLoaded(true); await loadHistory({ silent: true }); }
      else { setBulkLoaded(true); await loadBulk({ silent: true }); }
    } finally {
      setRefreshing(false);
    }
  }, [activeTab, loadOngoing, loadHistory, loadBulk]);

  async function reorder(orderId: string) {
    setReordering(orderId);
    try {
      await api.reorder(orderId);
      await loadFromServer();
      onReordered();
    } catch (e) {
      // surface inline via the card; nothing to do here
    } finally {
      setReordering(null);
    }
  }

  function handleRated(orderId: string, rating: number) {
    setHistory((prev) =>
      prev.map((o) =>
        o.orderId === orderId ? { ...o, review: { rating } } : o,
      ),
    );
  }

  // Inline bulk detail view
  if (openBulkOrderId) {
    return (
      <BulkOrderDetailScreen
        bulkOrderId={openBulkOrderId}
        onBack={() => setOpenBulkOrderId(null)}
      />
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader />
      <TabRow activeTab={activeTab} onTab={setActiveTab} />

      {activeTab === 'ongoing' ? (
        ongoingLoading && ongoing.length === 0 ? (
          <OrdersSkeleton />
        ) : ongoingError && ongoing.length === 0 ? (
          <ErrorState message={ongoingError} onRetry={() => loadOngoing()} />
        ) : (
          <FlatList
            data={ongoing}
            keyExtractor={(o) => o.orderId}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListEmptyComponent={
              <EmptyState
                title="No ongoing orders"
                subtitle="Start shopping to place your first order!"
                action={<Button label={t.orders.startShopping} onPress={onBrowse} fullWidth={false} />}
              />
            }
            renderItem={({ item: o }) => (
              <OrderCard
                order={o}
                reordering={reordering === o.orderId}
                onOpen={() => onOpenOrder(o.orderId)}
                onReorder={() => reorder(o.orderId)}
                onRated={(rating) => handleRated(o.orderId, rating)}
              />
            )}
          />
        )
      ) : activeTab === 'history' ? (
        historyLoading && history.length === 0 ? (
          <OrdersSkeleton />
        ) : historyError && history.length === 0 ? (
          <ErrorState message={historyError} onRetry={() => loadHistory()} />
        ) : (
          <FlatList
            data={history}
            keyExtractor={(o) => o.orderId}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            onEndReached={loadMoreHistory}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={
              <EmptyState
                title="No order history"
                subtitle="Your completed and cancelled orders will appear here."
              />
            }
            ListFooterComponent={
              historyLoadingMore ? (
                <ActivityIndicator style={styles.footer} color={theme.color.primary} />
              ) : null
            }
            renderItem={({ item: o }) => (
              <OrderCard
                order={o}
                reordering={reordering === o.orderId}
                onOpen={() => onOpenOrder(o.orderId)}
                onReorder={() => reorder(o.orderId)}
                onRated={(rating) => handleRated(o.orderId, rating)}
              />
            )}
          />
        )
      ) : (
        bulkLoading && bulkOrders.length === 0 ? (
          <View style={styles.bulkLoadingWrap}>
            <ActivityIndicator color={BULK_PURPLE} />
          </View>
        ) : bulkError && bulkOrders.length === 0 ? (
          <ErrorState message={bulkError} onRetry={() => loadBulk()} />
        ) : (
          <FlatList
            data={bulkOrders}
            keyExtractor={(b) => b.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            onEndReached={loadMoreBulk}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={
              <EmptyState
                title="No bulk orders yet"
                subtitle="Your multi-shop orders will appear here."
              />
            }
            ListFooterComponent={
              bulkLoadingMore ? (
                <ActivityIndicator style={styles.footer} color={BULK_PURPLE} />
              ) : null
            }
            renderItem={({ item }) => (
              <BulkOrderCard order={item} onOpen={() => setOpenBulkOrderId(item.id)} />
            )}
          />
        )
      )}
    </View>
  );
}

/** Tab row with three tabs: Ongoing / History / Bulk. */
function TabRow({
  activeTab,
  onTab,
}: {
  activeTab: ActiveTab;
  onTab: (t: ActiveTab) => void;
}) {
  return (
    <View style={styles.tabRow}>
      {(['ongoing', 'history', 'bulk'] as ActiveTab[]).map((key) => {
        const active = activeTab === key;
        const label = key === 'ongoing' ? 'Ongoing' : key === 'history' ? 'History' : 'Bulk';
        const isBulk = key === 'bulk';
        return (
          <Pressable
            key={key}
            style={[styles.tabBtn, active && styles.tabBtnActive]}
            onPress={() => onTab(key)}
          >
            <View style={styles.tabBtnInner}>
              <Text style={[
                styles.tabBtnText,
                active && (isBulk ? styles.tabBtnTextBulk : styles.tabBtnTextActive),
              ]}>
                {label}
              </Text>
              {isBulk ? (
                <View style={styles.bulkPill}>
                  <Text style={styles.bulkPillText}>BULK</Text>
                </View>
              ) : null}
            </View>
            {active ? (
              <View style={[styles.tabUnderline, isBulk && styles.tabUnderlineBulk]} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Card for a single bulk order in the list. */
function BulkOrderCard({
  order,
  onOpen,
}: {
  order: BulkOrderSummary;
  onOpen: () => void;
}) {
  const shopNames = order.orders.map((o) => o.shop.name).join(' + ');
  const placedOn = new Date(order.createdAt).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
  const statusMeta = bulkStatusMeta(order.status);

  return (
    <Pressable style={styles.card} onPress={onOpen}>
      {/* Header row: shortId + status badge */}
      <View style={styles.cardCategoryRow}>
        <View style={styles.cardIdRow}>
          <View style={styles.bulkBadgeInline}>
            <Text style={styles.bulkBadgeInlineText}>BULK</Text>
          </View>
          <Text style={styles.cardCategory}>{order.shortId}</Text>
        </View>
        <Text style={[styles.cardStatusBadge, { backgroundColor: statusMeta.bg, color: statusMeta.fg }]}>
          {statusMeta.label}
        </Text>
      </View>

      {/* Shop names */}
      <View style={styles.cardMain}>
        <View style={styles.bulkShopIconWrap}>
          <Text style={styles.bulkShopIcon}>🛍</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.shopName} numberOfLines={2}>{shopNames}</Text>
          <Text style={styles.orderMeta}>
            {formatRupees(order.totalPaise)}{'  •  '}{placedOn}
          </Text>
          <Text style={styles.subOrderCount}>
            {order.orders.length} shop{order.orders.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
    </Pressable>
  );
}

/** Map a bulk-order status string to display label + colours. */
function bulkStatusMeta(status: string): { label: string; bg: string; fg: string } {
  switch (status.toUpperCase()) {
    case 'DELIVERED':
      return { label: 'Delivered', bg: theme.color.successLight, fg: theme.color.success };
    case 'OUT_FOR_DELIVERY':
      return { label: 'Out for delivery', bg: theme.color.infoLight, fg: theme.color.info };
    case 'READY':
    case 'RIDER_ASSIGNED':
      return { label: 'Ready', bg: theme.color.infoLight, fg: theme.color.info };
    case 'PREPARING':
      return { label: 'Preparing', bg: theme.color.accentLight, fg: '#92400E' };
    case 'PLACED':
    case 'ACCEPTED':
      return { label: 'Placed', bg: theme.color.accentLight, fg: '#92400E' };
    case 'AWAITING_PAYMENT':
      return { label: 'Awaiting payment', bg: theme.color.warningLight, fg: theme.color.warning };
    case 'CANCELLED':
    case 'REJECTED':
      return { label: status.charAt(0) + status.slice(1).toLowerCase(), bg: theme.color.dangerLight, fg: theme.color.danger };
    default:
      return { label: status, bg: theme.color.surfaceAlt, fg: theme.color.textMuted };
  }
}

/** Placeholder order-row list shown while the first page loads. */
function OrdersSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.card}>
          <View style={styles.cardCategoryRow}>
            <SkeletonBlock width={90} height={12} />
            <SkeletonBlock width={70} height={20} radius={theme.radius.pill} />
          </View>
          <View style={styles.cardMain}>
            <SkeletonBlock width={48} height={48} radius={theme.radius.md} />
            <View style={styles.flex}>
              <SkeletonBlock width="60%" height={16} />
              <SkeletonBlock width="80%" height={13} style={{ marginTop: theme.space.xs }} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

function ScreenHeader() {
  const { t } = useLang();
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>{t.orders.title}</Text>
    </View>
  );
}

function OrderCard({
  order,
  reordering,
  onOpen,
  onReorder,
  onRated,
}: {
  order: OrderHistoryItem;
  reordering: boolean;
  onOpen: () => void;
  onReorder: () => void;
  onRated: (rating: number) => void;
}) {
  const { t } = useLang();
  const [submitting, setSubmitting] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  const delivered = order.status === OrderStatus.DELIVERED;
  const s = statusMeta(order.status, t);
  const placedOn = new Date(order.createdAt).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
  const addr = [order.shop.addressLine, order.shop.city].filter(Boolean).join(', ');

  async function submitRating(stars: number) {
    setSubmitting(true);
    setRateError(null);
    try {
      await api.createReview({ orderId: order.orderId, rating: stars });
      onRated(stars);
    } catch (e) {
      setRateError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.card}>
      {/* Category + status badge row */}
      <View style={styles.cardCategoryRow}>
        <Text style={styles.cardCategory}>{order.shortId ?? `OR${order.orderId.replace(/-/g,'').slice(0,8).toUpperCase()}`}</Text>
        <Text style={[styles.cardStatusBadge,
          delivered ? styles.statusDelivered :
          order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REJECTED ? styles.statusCancelled :
          styles.statusOngoing
        ]}>
          {s.label}
        </Text>
      </View>

      {/* Main card row: photo + info + ID */}
      <Pressable onPress={onOpen} style={styles.cardMain}>
        {order.shop.storefrontPhotoUrl ? (
          <Image source={{ uri: order.shop.storefrontPhotoUrl }} style={styles.shopThumb} />
        ) : (
          <View style={[styles.shopThumb, styles.shopThumbFallback]}>
            <Text style={styles.shopThumbEmoji}>{order.shop.name.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.flex}>
          <View style={styles.shopNameRow}>
            <Text style={styles.shopName} numberOfLines={1}>{order.shop.name}</Text>
            <Text style={styles.orderId}>{order.shortId ?? `#OR${order.orderId.replace(/-/g,'').slice(0,6).toUpperCase()}`}</Text>
          </View>
          <Text style={styles.orderMeta}>
            {formatRupees(order.totalPaise)}{'  '}|{'  '}{placedOn}{'  •  '}{order.itemCount} {order.itemCount === 1 ? 'Item' : 'Items'}
          </Text>
        </View>
      </Pressable>

      {/* Rate + Reorder buttons */}
      <View style={styles.cardActions}>
        {delivered ? (
          <Pressable style={styles.rateBtn} onPress={() => {
            if (!order.review && !submitting) submitRating(5);
          }} disabled={!!order.review || submitting}>
            <Text style={styles.rateBtnText}>
              {order.review ? `★ Rated ${order.review.rating}` : submitting ? 'Saving…' : '☆ Rate'}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.flex} />
        )}
        <Pressable style={[styles.reorderBtn, reordering && styles.reorderBtnBusy]} onPress={onReorder} disabled={reordering}>
          <Text style={styles.reorderBtnText}>{reordering ? '…' : 'Re-Order'}</Text>
        </Pressable>
      </View>

      {rateError ? <Text style={styles.rateError}>{rateError}</Text> : null}
    </View>
  );
}

function statusMeta(status: OrderStatus, t: Strings): { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' } {
  switch (status) {
    case OrderStatus.DELIVERED:
      return { label: t.orders.statusDelivered, tone: 'success' };
    case OrderStatus.OUT_FOR_DELIVERY:
      return { label: t.orders.statusOutForDelivery, tone: 'info' };
    case OrderStatus.READY:
    case OrderStatus.RIDER_ASSIGNED:
      return { label: t.orders.statusReady, tone: 'info' };
    case OrderStatus.PREPARING:
      return { label: t.orders.statusPreparing, tone: 'info' };
    case OrderStatus.PLACED:
    case OrderStatus.ACCEPTED:
      return { label: t.orders.statusPlaced, tone: 'warning' };
    case OrderStatus.AWAITING_PAYMENT:
      return { label: t.orders.statusAwaitingPayment, tone: 'warning' };
    case OrderStatus.REJECTED:
      return { label: t.orders.statusRejected, tone: 'danger' };
    case OrderStatus.CANCELLED:
      return { label: t.orders.statusCancelled, tone: 'danger' };
    case OrderStatus.REFUND_PENDING:
      return { label: t.orders.statusRefundPending, tone: 'warning' };
    case OrderStatus.REFUNDED:
      return { label: t.orders.statusRefunded, tone: 'success' };
    default:
      return { label: status, tone: 'neutral' };
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  flex: { flex: 1 },

  header: { paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md, backgroundColor: theme.color.bg },
  headerTitle: { fontSize: theme.font.h1, fontWeight: "800", color: theme.color.text },

  list: { padding: theme.space.lg, gap: theme.space.md, paddingBottom: theme.space.xxl },
  footer: { paddingVertical: theme.space.lg },
  bulkLoadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  card: {
    backgroundColor: theme.color.card,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    gap: theme.space.md,
    ...shadow.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
  shopThumb: { width: 48, height: 48, borderRadius: theme.radius.md, backgroundColor: theme.color.surface },
  shopThumbFallback: { alignItems: 'center', justifyContent: 'center' },
  shopThumbText: { fontSize: 24 },
  shopName: { fontSize: theme.font.h3, fontWeight: "700", color: theme.color.text },
  shopAddr: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 1 },
  viewMenu: { fontSize: theme.font.small, color: theme.color.primary, fontWeight: "600", marginTop: 3 },

  itemsBox: {
    gap: theme.space.xs,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingTop: theme.space.md,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  itemDot: { width: 8, height: 8, borderRadius: 2, borderWidth: 1.5, borderColor: theme.color.success },
  itemText: { flex: 1, fontSize: theme.font.body, color: theme.color.text, fontWeight: "500" },
  itemMore: { fontSize: theme.font.small, color: theme.color.textMuted, marginLeft: 16 },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingTop: theme.space.md,
  },
  placedOn: { fontSize: theme.font.small, color: theme.color.textMuted },
  statusLine: { fontSize: theme.font.small, color: theme.color.text, fontWeight: "600", marginTop: 1 },
  total: { fontSize: theme.font.h3, fontWeight: "700", color: theme.color.text },
  chevron: { fontSize: theme.font.h2, color: theme.color.textMuted },

  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingTop: theme.space.md,
  },
  rateRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
  rateLabel: { fontSize: theme.font.body, fontWeight: "700", color: theme.color.text, marginRight: theme.space.xs },
  rateStar: { fontSize: 22, color: theme.color.border },
  rateStarFilled: { fontSize: 22, color: theme.color.star },
  rateError: { fontSize: theme.font.small, color: theme.color.danger },

  // Three-tab row
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.color.border, marginHorizontal: theme.space.lg },
  tabBtn: { flex: 1, paddingVertical: theme.space.md, alignItems: 'center', position: 'relative' },
  tabBtnActive: {},
  tabBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tabBtnText: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  tabBtnTextActive: { color: theme.color.primary, fontWeight: '700' },
  tabBtnTextBulk: { color: BULK_PURPLE, fontWeight: '700' },
  tabUnderline: { position: 'absolute', bottom: -1, left: 0, right: 0, height: 2, backgroundColor: theme.color.primary, borderRadius: 1 },
  tabUnderlineBulk: { backgroundColor: BULK_PURPLE },

  // Inline BULK pill on the tab
  bulkPill: {
    backgroundColor: BULK_PURPLE_LIGHT,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  bulkPillText: { fontSize: 9, fontWeight: '800', color: BULK_PURPLE, letterSpacing: 0.5 },

  cardCategoryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.space.xs },
  cardIdRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardCategory: { fontSize: theme.font.tiny, color: theme.color.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardStatusBadge: { fontSize: theme.font.tiny, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill, overflow: 'hidden' },
  statusDelivered: { backgroundColor: theme.color.successLight, color: theme.color.primary },
  statusCancelled: { backgroundColor: '#FEE2E2', color: '#B91C1C' },
  statusOngoing: { backgroundColor: theme.color.accentLight, color: '#92400E' },
  cardMain: { flexDirection: 'row', gap: theme.space.md, alignItems: 'flex-start' },
  shopThumbEmoji: { fontSize: 32 },
  shopNameRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs, flexWrap: 'wrap' },
  orderId: { fontSize: theme.font.tiny, color: theme.color.textFaint, fontFamily: 'monospace' },
  orderMeta: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  rateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: theme.space.xs, paddingHorizontal: theme.space.md, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.primary },
  rateBtnText: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.primary },
  reorderBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: theme.space.xs, paddingHorizontal: theme.space.md, borderRadius: theme.radius.md, backgroundColor: theme.color.primary },
  reorderBtnBusy: { opacity: 0.6 },
  reorderBtnText: { fontSize: theme.font.small, fontWeight: '700', color: '#fff' },

  // Bulk order card extras
  bulkBadgeInline: {
    backgroundColor: BULK_PURPLE_LIGHT,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  bulkBadgeInlineText: { fontSize: 9, fontWeight: '800', color: BULK_PURPLE, letterSpacing: 0.5 },
  bulkShopIconWrap: {
    width: 48, height: 48, borderRadius: theme.radius.md,
    backgroundColor: BULK_PURPLE_LIGHT,
    alignItems: 'center', justifyContent: 'center',
  },
  bulkShopIcon: { fontSize: 24 },
  subOrderCount: { fontSize: theme.font.tiny, color: BULK_PURPLE, fontWeight: '600', marginTop: 2 },
});
