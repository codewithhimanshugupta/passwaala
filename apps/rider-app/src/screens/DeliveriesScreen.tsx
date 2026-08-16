import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { getPrefetchedHistory } from '../riderPrefetch';
import { formatRupees, theme } from '../theme';
import { Badge, Banner, Card, ErrorText } from '../ui';
import { DisputeModal } from '../components/DisputeModal';
import { useLang } from '../i18n/LanguageContext';
import type { RiderJob, BulkRiderJob } from '../types';

const PAGE_SIZE = 20;

type HistoryItem = { type: 'order'; data: RiderJob } | { type: 'bulk'; data: BulkRiderJob };

/** Merge order + bulk history rows into one list, newest first. */
function mergeHistory(orders: RiderJob[], bulkOrders: BulkRiderJob[]): HistoryItem[] {
  return [
    ...(orders ?? []).map((d): HistoryItem => ({ type: 'order', data: d })),
    ...(bulkOrders ?? []).map((d): HistoryItem => ({ type: 'bulk', data: d })),
  ].sort((a, b) => {
    const ta = new Date((a.data.updatedAt ?? a.data.createdAt) as string).getTime();
    const tb = new Date((b.data.updatedAt ?? b.data.createdAt) as string).getTime();
    return tb - ta;
  });
}

export function DeliveriesScreen() {
  const prefetched = getPrefetchedHistory();
  const [items, setItems] = useState<HistoryItem[]>(
    prefetched ? mergeHistory(prefetched.orders, prefetched.bulkOrders) : [],
  );
  const [loading, setLoading] = useState(!prefetched);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(prefetched?.ordersNextCursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const { t } = useLang();

  const load = useCallback(async () => {
    try {
      const page = (await api.riderDeliveryHistory({ limit: PAGE_SIZE })) as unknown as {
        orders: RiderJob[];
        ordersNextCursor: string | null;
        bulkOrders: BulkRiderJob[];
      };
      setItems(mergeHistory(page.orders, page.bulkOrders));
      setNextCursor(page.ordersNextCursor);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const page = (await api.riderDeliveryHistory({ limit: PAGE_SIZE, cursor: nextCursor })) as unknown as {
        orders: RiderJob[];
        ordersNextCursor: string | null;
        bulkOrders: BulkRiderJob[];
      };
      const newItems: HistoryItem[] = (page.orders ?? []).map((d): HistoryItem => ({ type: 'order', data: d }));
      setItems((prev) => [...prev, ...newItems]);
      setNextCursor(page.ordersNextCursor);
    } catch {
      /* keep loaded; next scroll retries */
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={theme.color.accent} size="large" /></View>;
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={items}
      keyExtractor={(item) => item.data.id}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.accent} />
      }
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      ListHeaderComponent={
        <>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Text style={styles.heading}>{t.deliveries.heading}</Text>
        </>
      }
      ListEmptyComponent={
        <Banner tone="info" title={t.deliveries.emptyTitle} message={t.deliveries.emptyMessage} />
      }
      ListFooterComponent={
        loadingMore ? <ActivityIndicator style={styles.footer} color={theme.color.accent} /> : null
      }
      renderItem={({ item }) =>
        item.type === 'bulk'
          ? <BulkDeliveryCard bulk={item.data} />
          : <DeliveryCard delivery={item.data} />
      }
    />
  );
}

function BulkDeliveryCard({ bulk }: { bulk: BulkRiderJob }) {
  const { t } = useLang();
  const dateStr = bulk.updatedAt ?? bulk.createdAt;
  const deliveredAt = dateStr
    ? new Date(dateStr as string).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null;
  const earnedPaise = bulk.baseDeliveryFeePaise + bulk.multiShopSurchargePaise;
  const drop = [bulk.address?.line, bulk.address?.landmark].filter(Boolean).join(', ');
  return (
    <Card>
      <View style={styles.cardHeader}>
        <View style={styles.headerInfo}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={styles.bulkBadge}><Text style={styles.bulkBadgeText}>BULK</Text></View>
            <Text style={styles.shopName} numberOfLines={1}>
              {bulk.orders?.map((o) => o.shop?.name).filter(Boolean).join(' + ')}
            </Text>
          </View>
          <Text style={styles.orderNo}>{bulk.shortId ?? `BLK${bulk.id.replace(/-/g,'').slice(0,8).toUpperCase()}`}</Text>
        </View>
        <Badge label={t.deliveries.delivered} tone="success" />
      </View>

      <View style={styles.leg}>
        <Text style={styles.legLabel}>STOPS</Text>
        <Text style={styles.legText}>{bulk.orders?.length ?? 0} shops</Text>
      </View>
      <View style={styles.leg}>
        <Text style={styles.legLabel}>{t.deliveries.dropLabel}</Text>
        <Text style={styles.legText}>{drop || t.deliveries.dropUnavailable}</Text>
      </View>

      <View style={styles.metaRow}>
        <Text style={[styles.meta, styles.earnedAmount]}>
          {t.deliveries.earned} {formatRupees(earnedPaise)}
        </Text>
        {deliveredAt ? (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.meta}>{deliveredAt}</Text>
          </>
        ) : null}
      </View>
      <View style={styles.orderTotalRow}>
        <Text style={styles.orderTotalLabel}>Order value</Text>
        <Text style={styles.orderTotalValue}>{formatRupees(bulk.totalPaise)}</Text>
      </View>
    </Card>
  );
}

function DeliveryCard({ delivery }: { delivery: RiderJob }) {
  const { t } = useLang();
  const itemCount = delivery.items?.reduce((sum, i) => sum + (i.qty ?? 0), 0) ?? 0;
  const pickup = [delivery.shop?.addressLine, delivery.shop?.city].filter(Boolean).join(', ');
  const drop = [delivery.address?.line, delivery.address?.landmark].filter(Boolean).join(', ');
  const dateStr = delivery.updatedAt ?? delivery.createdAt;
  const deliveredAt = dateStr
    ? new Date(dateStr).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null;
  return (
    <Card>
      <View style={styles.cardHeader}>
        <View style={styles.headerInfo}>
          <Text style={styles.shopName} numberOfLines={1}>{delivery.shop?.name ?? t.common.shop}</Text>
          <Text style={styles.orderNo}>{delivery.shortId ?? `OR${delivery.id.replace(/-/g,"").slice(0,8).toUpperCase()}`}</Text>
        </View>
        <Badge label={t.deliveries.delivered} tone="success" />
      </View>

      <View style={styles.leg}>
        <Text style={styles.legLabel}>{t.deliveries.pickupLabel}</Text>
        <Text style={styles.legText}>{pickup || t.deliveries.pickupUnavailable}</Text>
      </View>
      <View style={styles.leg}>
        <Text style={styles.legLabel}>{t.deliveries.dropLabel}</Text>
        <Text style={styles.legText}>{drop || t.deliveries.dropUnavailable}</Text>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>{t.deliveries.itemCount(itemCount)}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={[styles.meta, styles.earnedAmount]}>
          {t.deliveries.earned} {formatRupees(delivery.deliveryFeePaise)}
        </Text>
        {deliveredAt ? (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.meta}>{deliveredAt}</Text>
          </>
        ) : null}
      </View>
      <View style={styles.orderTotalRow}>
        <Text style={styles.orderTotalLabel}>Order value</Text>
        <Text style={styles.orderTotalValue}>{formatRupees(delivery.adjustedTotalPaise ?? delivery.originalTotalPaise)}</Text>
      </View>
      {((delivery.extraDeliveryDuePaise ?? 0) + (delivery.addedItemsDuePaise ?? 0)) > 0 ? (
        <View style={[styles.orderTotalRow, { marginTop: 4 }]}>
          <Text style={[styles.orderTotalLabel, { color: '#92400E' }]}>Collect at delivery</Text>
          <Text style={[styles.orderTotalValue, { color: '#92400E' }]}>
            {formatRupees((delivery.extraDeliveryDuePaise ?? 0) + (delivery.addedItemsDuePaise ?? 0))}
          </Text>
        </View>
      ) : null}
      <DisputeModal
        orderId={delivery.id}
        orderCreatedAt={delivery.createdAt}
        senderRole="RIDER"
        inline={true}
        orderSummary={{
          shopName: delivery.shop?.name,
          totalPaise: delivery.adjustedTotalPaise ?? delivery.originalTotalPaise,
          itemCount,
          deliveryFeePaise: delivery.deliveryFeePaise,
          pickup,
          drop,
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.bg },
  screen: { flex: 1, backgroundColor: theme.color.bg },
  content: { padding: theme.space.lg, gap: theme.space.md, paddingBottom: theme.space.xxl },
  footer: { paddingVertical: theme.space.lg },
  heading: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.sm, marginBottom: theme.space.md },
  headerInfo: { flex: 1, gap: 1 },
  orderNo: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textFaint, letterSpacing: 0.5 },
  shopName: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  leg: { marginBottom: theme.space.sm },
  legLabel: { fontSize: theme.font.tiny, fontWeight: '800', color: theme.color.textFaint, letterSpacing: 0.5 },
  legText: { fontSize: theme.font.body, color: theme.color.text, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, marginTop: theme.space.xs },
  meta: { fontSize: theme.font.small, color: theme.color.textMuted, fontWeight: '600' },
  metaDot: { color: theme.color.textFaint },
  earnedAmount: { color: theme.color.success, fontWeight: '800' },
  orderTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: theme.space.xs, borderTopWidth: 1, borderTopColor: theme.color.border, marginTop: theme.space.xs },
  orderTotalLabel: { fontSize: theme.font.small, color: theme.color.textMuted },
  orderTotalValue: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  bulkBadge: { backgroundColor: '#7C3AED', borderRadius: theme.radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  bulkBadgeText: { color: '#FFFFFF', fontSize: theme.font.tiny, fontWeight: '800' },
});
