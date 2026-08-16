import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { theme } from '../theme';
import { useLang } from '../i18n/LanguageContext';

interface BulkOrderSummary {
  id: string;
  shortId: string | null;
  status: string;
  totalPaise: number;
  baseDeliveryFeePaise: number;
  multiShopSurchargePaise: number;
  paymentMethod: string;
  createdAt: string;
  orders: Array<{ id: string; shortId?: string | null; shopId: string; shop?: { name: string } }>;
}

function fmt(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`;
}
function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

const STATUS_COLOR: Record<string, string> = {
  PLACED: '#6B7280',
  ACCEPTED_ALL: '#0891B2',
  READY_ALL: '#D97706',
  RIDER_ASSIGNED: '#7C3AED',
  PICKING_UP: '#7C3AED',
  OUT_FOR_DELIVERY: '#EA580C',
  DELIVERED: '#059669',
  CANCELLED: '#DC2626',
};

export function BulkOrdersScreen() {
  const { t } = useLang();
  const [orders, setOrders] = useState<BulkOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (replace = true) => {
    try {
      const result = await (api as any).adminListBulkOrders({ limit: 20, ...(replace ? {} : { cursor: cursor ?? undefined }) }) as { items: BulkOrderSummary[]; nextCursor: string | null };
      if (replace) {
        setOrders(result.items);
      } else {
        setOrders((prev) => [...prev, ...result.items]);
      }
      setCursor(result.nextCursor);
      setHasMore(!!result.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cursor]);

  useEffect(() => { void load(true); }, []);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={theme.color.accent} size="large" /></View>;
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor={theme.color.accent} />}
    >
      <Text style={styles.title}>Bulk Orders</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {orders.length === 0 ? (
        <Text style={styles.empty}>No bulk orders yet.</Text>
      ) : orders.map((o) => (
        <Pressable key={o.id} style={styles.card} onPress={() => setExpanded((prev) => prev === o.id ? null : o.id)}>
          <View style={styles.cardTop}>
            <View style={styles.cardLeft}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={styles.bulkBadge}><Text style={styles.bulkBadgeText}>BULK</Text></View>
                <Text style={styles.shortId}>{o.shortId ?? o.id.slice(0, 10)}</Text>
              </View>
              <Text style={styles.shopList} numberOfLines={1}>
                {o.orders.map((s) => s.shop?.name ?? s.shopId).join(' + ')}
              </Text>
              <Text style={styles.meta}>{fmtDate(o.createdAt)} · {o.paymentMethod}</Text>
            </View>
            <View style={styles.cardRight}>
              <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[o.status] ?? '#6B7280' }]}>
                <Text style={styles.statusText}>{o.status.replace(/_/g, ' ')}</Text>
              </View>
              <Text style={styles.total}>{fmt(o.totalPaise)}</Text>
            </View>
          </View>
          {expanded === o.id ? (
            <View style={styles.detail}>
              <Row label="Base delivery" value={fmt(o.baseDeliveryFeePaise)} />
              <Row label="Multi-shop surcharge" value={fmt(o.multiShopSurchargePaise)} />
              <Row label="Shops" value={String(o.orders.length)} />
              {o.orders.map((sub, idx) => (
                <Text key={sub.id} style={styles.subOrder}>
                  Stop {idx + 1}: #{sub.shortId ?? sub.id.slice(0, 8).toUpperCase()} · {sub.shop?.name ?? sub.shopId}
                </Text>
              ))}
            </View>
          ) : null}
        </Pressable>
      ))}
      {hasMore ? (
        <Pressable style={styles.loadMore} onPress={() => void load(false)}>
          <Text style={styles.loadMoreText}>Load more</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  scroll: { padding: theme.space.lg, gap: theme.space.md, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text, marginBottom: theme.space.sm },
  error: { color: theme.color.critical, fontWeight: '600' },
  empty: { color: theme.color.textMuted, textAlign: 'center', marginTop: theme.space.xl },
  card: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, padding: theme.space.lg, gap: theme.space.sm, borderWidth: 1, borderColor: theme.color.border },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
  cardLeft: { flex: 1, gap: 3 },
  cardRight: { alignItems: 'flex-end', gap: theme.space.xs },
  bulkBadge: { backgroundColor: '#7C3AED', borderRadius: theme.radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  bulkBadgeText: { color: '#fff', fontSize: theme.font.tiny, fontWeight: '800' },
  shortId: { fontSize: theme.font.body, fontWeight: '800', color: theme.color.text },
  shopList: { fontSize: theme.font.small, color: theme.color.textMuted },
  meta: { fontSize: theme.font.tiny, color: theme.color.textFaint },
  statusBadge: { borderRadius: theme.radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { color: '#fff', fontSize: theme.font.tiny, fontWeight: '700' },
  total: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  detail: { borderTopWidth: 1, borderTopColor: theme.color.border, paddingTop: theme.space.sm, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { fontSize: theme.font.small, color: theme.color.textMuted },
  rowValue: { fontSize: theme.font.small, color: theme.color.text, fontWeight: '600' },
  subOrder: { fontSize: theme.font.small, color: theme.color.textMuted, paddingLeft: theme.space.sm },
  loadMore: { alignItems: 'center', paddingVertical: theme.space.md },
  loadMoreText: { color: theme.color.primary, fontWeight: '700' },
});
