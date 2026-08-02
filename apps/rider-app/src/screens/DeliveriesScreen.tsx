import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { formatRupees, theme } from '../theme';
import { Badge, Banner, Card, ErrorText } from '../ui';
import { DisputeModal } from '../components/DisputeModal';
import { useLang } from '../i18n/LanguageContext';
import type { RiderJob } from '../types';

/** Deliveries fetched per page (initial load + each scroll-to-end). */
const PAGE_SIZE = 20;

/**
 * DeliveriesScreen — the rider's completed-delivery HISTORY. Active work (claimed
 * orders being picked up / delivered) lives on the Jobs tab; an order only lands
 * here once it's DELIVERED. Keyset paginated — loads a page at a time as the
 * rider scrolls, so a long history never ships in one call.
 */
export function DeliveriesScreen() {
  const [deliveries, setDeliveries] = useState<RiderJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const { t } = useLang();

  const load = useCallback(async () => {
    try {
      const page = (await api.riderDeliveryHistory({ limit: PAGE_SIZE })) as {
        items: RiderJob[];
        nextCursor: string | null;
      };
      setDeliveries(page.items);
      setNextCursor(page.nextCursor);
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
      const page = (await api.riderDeliveryHistory({ limit: PAGE_SIZE, cursor: nextCursor })) as {
        items: RiderJob[];
        nextCursor: string | null;
      };
      setDeliveries((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      // Keep what's loaded; the next scroll retries.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.color.accent} size="large" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={deliveries}
      keyExtractor={(d) => d.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={theme.color.accent}
        />
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
        <Banner
          tone="info"
          title={t.deliveries.emptyTitle}
          message={t.deliveries.emptyMessage}
        />
      }
      ListFooterComponent={
        loadingMore ? <ActivityIndicator style={styles.footer} color={theme.color.accent} /> : null
      }
      renderItem={({ item }) => <DeliveryCard delivery={item} />}
    />
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
});
