import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { OrderStatus } from '@passwaala/shared';
import { api } from '../api';
import { refreshCart } from '../cart';
import type { OrderHistoryItem } from '../types';
import { formatRupees, shadow, theme } from '../theme';
import { Badge, Button, EmptyState, ErrorState, Loading } from '../ui';
import { useLang } from '../i18n/LanguageContext';
import type { Strings } from '../i18n/strings';

/** Orders fetched per page (initial load + each scroll-to-end). */
const PAGE_SIZE = 20;

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
  const [orders, setOrders] = useState<OrderHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reordering, setReordering] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'ongoing' | 'history'>('ongoing');
  // Keyset pagination: cursor for the next page (null = no more), + a guard so
  // onEndReached doesn't fire overlapping fetches.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Load the first page (fresh). Resets the list + cursor.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = (await api.orderHistory({ limit: PAGE_SIZE })) as {
        items: OrderHistoryItem[];
        nextCursor: string | null;
      };
      setOrders(page.items);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Append the next page when the user scrolls to the end.
  const loadMore = useCallback(async () => {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const page = (await api.orderHistory({ limit: PAGE_SIZE, cursor: nextCursor })) as {
        items: OrderHistoryItem[];
        nextCursor: string | null;
      };
      setOrders((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      // Keep what's loaded; the next scroll retries.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reorder(orderId: string) {
    setReordering(orderId);
    try {
      await api.reorder(orderId);
      await refreshCart();
      onReordered();
    } catch (e) {
      // surface inline via the card; nothing to do here
    } finally {
      setReordering(null);
    }
  }

  function handleRated(orderId: string, rating: number) {
    setOrders((prev) =>
      prev.map((o) =>
        o.orderId === orderId ? { ...o, review: { rating } } : o,
      ),
    );
  }

  if (loading) return <Loading label={t.orders.loadingOrders} />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (orders.length === 0) {
    return (
      <View style={styles.root}>
        <ScreenHeader />
        <EmptyState
          emoji="📦"
          title={t.orders.noOrdersTitle}
          subtitle={t.orders.noOrdersSubtitle}
          action={<Button label={t.orders.startShopping} onPress={onBrowse} fullWidth={false} />}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader />

      {/* Ongoing / History tab switcher */}
      <View style={styles.tabRow}>
        <Pressable style={[styles.tabBtn, activeTab === 'ongoing' && styles.tabBtnActive]} onPress={() => setActiveTab('ongoing')}>
          <Text style={[styles.tabBtnText, activeTab === 'ongoing' && styles.tabBtnTextActive]}>Ongoing</Text>
          {activeTab === 'ongoing' ? <View style={styles.tabUnderline} /> : null}
        </Pressable>
        <Pressable style={[styles.tabBtn, activeTab === 'history' && styles.tabBtnActive]} onPress={() => setActiveTab('history')}>
          <Text style={[styles.tabBtnText, activeTab === 'history' && styles.tabBtnTextActive]}>History</Text>
          {activeTab === 'history' ? <View style={styles.tabUnderline} /> : null}
        </Pressable>
      </View>

      <FlatList
        data={orders.filter(o => {
          const terminal = [OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REJECTED, OrderStatus.REFUND_PENDING, OrderStatus.REFUNDED].includes(o.status as OrderStatus);
          return activeTab === 'ongoing' ? !terminal : terminal;
        })}
        keyExtractor={(o) => o.orderId}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          <EmptyState emoji={activeTab === 'ongoing' ? '🛍️' : '📦'}
            title={activeTab === 'ongoing' ? 'No ongoing orders' : 'No order history'}
            subtitle={activeTab === 'ongoing' ? 'Start shopping to place your first order!' : 'Your completed and cancelled orders will appear here.'}
            action={activeTab === 'ongoing' ? <Button label={t.orders.startShopping} onPress={onBrowse} fullWidth={false} /> : undefined}
          />
        }
        ListFooterComponent={
          loadingMore ? (
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
            <Text style={styles.shopThumbEmoji}>🏬</Text>
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

  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.color.border, marginHorizontal: theme.space.lg },
  tabBtn: { flex: 1, paddingVertical: theme.space.md, alignItems: 'center', position: 'relative' },
  tabBtnActive: {},
  tabBtnText: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  tabBtnTextActive: { color: theme.color.primary, fontWeight: '700' },
  tabUnderline: { position: 'absolute', bottom: -1, left: 0, right: 0, height: 2, backgroundColor: theme.color.primary, borderRadius: 1 },

  cardCategoryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.space.xs },
  cardCategory: { fontSize: theme.font.tiny, color: theme.color.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardStatusBadge: { fontSize: theme.font.tiny, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill },
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
});
