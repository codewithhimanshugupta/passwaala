import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '@passwaala/api-client';
import { api } from '../api';
import { formatRupees, theme } from '../theme';

const PAGE_SIZE = 30;

interface AdminOrder {
  orderId: string;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  deliveryMode: string;
  totalPaise: number;
  platformFeePaise: number;
  deliveryFeePaise: number;
  paymentConfirmed: boolean;
  paymentClaimedAt: string | null;
  codUpiClaimedAt: string | null;
  cancelledBy: string | null;
  reason: string | null;
  pickupOtp: string | null;
  riderPickupOtp: string | null;
  shop: { id: string; shortId?: string | null; name: string; city: string } | null;
  customer: { id: string; shortId?: string | null; name: string | null; phone: string | null } | null;
  rider: { id: string; shortId?: string | null; name: string | null; phone: string | null } | null;
  items: Array<{ nameSnapshot: string; qty: number; pricePaiseSnapshot: number }>;
  createdAt: string;
  updatedAt: string;
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  PLACED:            { bg: '#EFF6FF', fg: '#1D4ED8' },
  ACCEPTED:          { bg: '#ECFDF5', fg: '#065F46' },
  AWAITING_PAYMENT:  { bg: '#FEF3C7', fg: '#92400E' },
  PREPARING:         { bg: '#EDE9FE', fg: '#5B21B6' },
  READY:             { bg: '#ECFDF5', fg: '#065F46' },
  RIDER_ASSIGNED:    { bg: '#DBEAFE', fg: '#1E40AF' },
  OUT_FOR_DELIVERY:  { bg: '#FEF9C3', fg: '#713F12' },
  DELIVERED:         { bg: '#D1FAE5', fg: '#065F46' },
  CANCELLED:         { bg: '#FEE2E2', fg: '#991B1B' },
  REJECTED:          { bg: '#FEE2E2', fg: '#991B1B' },
  REFUND_PENDING:    { bg: '#FEF3C7', fg: '#92400E' },
  REFUNDED:          { bg: '#D1FAE5', fg: '#065F46' },
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

const LIVE = ['PLACED','ACCEPTED','AWAITING_PAYMENT','PREPARING','READY','RIDER_ASSIGNED','OUT_FOR_DELIVERY'];
const isLive = (s: string) => LIVE.includes(s);

export function OrdersScreen() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'live' | 'done'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setForbidden(false);
    try {
      const res = (await api.adminListOrders({ limit: PAGE_SIZE })) as { items: AdminOrder[]; nextCursor: string | null };
      setOrders(res.items);
      setNextCursor(res.nextCursor ?? null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else setError((e as Error).message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = (await api.adminListOrders({ limit: PAGE_SIZE, cursor: nextCursor })) as { items: AdminOrder[]; nextCursor: string | null };
      setOrders(prev => [...prev, ...res.items]);
      setNextCursor(res.nextCursor ?? null);
    } catch { /* keep what we have */ }
    finally { setLoadingMore(false); }
  }

  const q = search.trim().toLowerCase();
  const visible = orders.filter(o => {
    if (filter === 'live' && !isLive(o.status)) return false;
    if (filter === 'done' && isLive(o.status)) return false;
    if (!q) return true;
    return (
      o.orderNumber.toLowerCase().includes(q) ||
      o.shop?.name.toLowerCase().includes(q) ||
      o.customer?.phone?.includes(q) ||
      o.customer?.name?.toLowerCase().includes(q) ||
      o.rider?.phone?.includes(q) ||
      o.status.toLowerCase().includes(q)
    );
  });

  if (loading) return <View style={s.center}><ActivityIndicator color={theme.color.accent} size="large" /></View>;

  if (forbidden) return (
    <View style={s.center}>
      <View style={s.notice}>
        <Text style={s.noticeTitle}>Access denied</Text>
        <Text style={s.noticeBody}>Log in with an admin account.</Text>
      </View>
    </View>
  );

  return (
    <View style={s.wrap}>
      <ScrollView
        contentContainerStyle={s.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>Orders</Text>
            <Text style={s.sub}>{orders.length} loaded · {visible.length} shown</Text>
          </View>
          <Pressable style={s.refreshBtn} onPress={load}>
            <Text style={s.refreshBtnText}>Refresh</Text>
          </Pressable>
        </View>

        <TextInput
          style={s.searchInput}
          placeholder="Search by order #, shop, customer phone…"
          placeholderTextColor={theme.color.textFaint}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />

        <View style={s.filterRow}>
          {(['all','live','done'] as const).map(f => (
            <Pressable key={f} style={[s.filterBtn, filter === f && s.filterBtnActive]} onPress={() => setFilter(f)}>
              <Text style={[s.filterBtnText, filter === f && s.filterBtnTextActive]}>
                {f === 'all' ? 'All' : f === 'live' ? 'Live' : 'Completed'}
              </Text>
            </Pressable>
          ))}
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}
        {visible.length === 0 ? (
          <View style={s.empty}><Text style={s.emptyText}>No orders found</Text></View>
        ) : null}

        {visible.map(o => {
          const col = STATUS_COLORS[o.status] ?? { bg: theme.color.surfaceAlt, fg: theme.color.textMuted };
          const open = expanded === o.orderId;
          return (
            <Pressable key={o.orderId} style={s.card} onPress={() => setExpanded(open ? null : o.orderId)}>
              <View style={s.cardHead}>
                <View style={s.cardHeadLeft}>
                  <Text style={s.orderNo}>#{o.orderNumber}</Text>
                  <Text style={s.shopName} numberOfLines={1}>{o.shop?.name ?? '—'}</Text>
                  <Text style={s.meta}>{fmtDate(o.createdAt)}</Text>
                </View>
                <View style={s.cardHeadRight}>
                  <View style={[s.statusBadge, { backgroundColor: col.bg }]}>
                    <Text style={[s.statusText, { color: col.fg }]}>{o.status}</Text>
                  </View>
                  <Text style={s.total}>{formatRupees(o.totalPaise)}</Text>
                </View>
              </View>

              {open ? (
                <View style={s.detail}>
                  {/* Parties */}
                  <Row label="Shop" value={`${o.shop?.shortId ?? ''} · ${o.shop?.name ?? '—'}${o.shop?.city ? ` · ${o.shop.city}` : ''}`} />
                  <Row label="Customer" value={`${o.customer?.shortId ?? ''} · ${o.customer?.name ?? '—'} · ${o.customer?.phone ?? ''}`} />
                  {o.rider ? <Row label="Rider" value={`${o.rider.shortId ?? ''} · ${o.rider.name ?? '—'} · ${o.rider.phone ?? ''}`} /> : null}

                  {/* Money */}
                  <Row label="Payment" value={`${o.paymentMethod} · ${o.deliveryMode}`} />
                  <Row label="Total" value={formatRupees(o.totalPaise)} />
                  <Row label="Platform fee" value={formatRupees(o.platformFeePaise)} />
                  <Row label="Delivery fee" value={formatRupees(o.deliveryFeePaise)} />
                  <Row label="Payment confirmed" value={o.paymentConfirmed ? 'Yes' : 'No'} warn={!o.paymentConfirmed && o.paymentMethod === 'UPI_DIRECT'} />
                  {o.paymentClaimedAt ? <Row label="Payment claimed at" value={fmtDate(o.paymentClaimedAt)} /> : null}
                  {o.codUpiClaimedAt ? <Row label="COD UPI claimed at" value={fmtDate(o.codUpiClaimedAt)} /> : null}

                  {/* OTPs */}
                  {o.pickupOtp ? <OtpRow label="Customer handoff OTP" otp={o.pickupOtp} /> : null}
                  {o.riderPickupOtp && o.deliveryMode === 'PLATFORM_RIDER' ? <OtpRow label="Shop → rider pickup OTP" otp={o.riderPickupOtp} /> : null}

                  {/* Cancellation */}
                  {o.cancelledBy ? <Row label="Cancelled by" value={o.cancelledBy} warn /> : null}
                  {o.reason ? <Row label="Reason" value={o.reason} /> : null}

                  {/* Items */}
                  <Text style={s.itemsTitle}>Items</Text>
                  {o.items.map((it, i) => (
                    <Text key={i} style={s.itemRow}>
                      {it.qty}× {it.nameSnapshot} — {formatRupees(it.pricePaiseSnapshot)}
                    </Text>
                  ))}
                </View>
              ) : null}
            </Pressable>
          );
        })}

        {nextCursor ? (
          <Pressable style={s.loadMore} onPress={loadMore} disabled={loadingMore}>
            {loadingMore
              ? <ActivityIndicator color={theme.color.accent} />
              : <Text style={s.loadMoreText}>Load more</Text>}
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, warn && s.rowWarn]}>{value}</Text>
    </View>
  );
}

function OtpRow({ label, otp }: { label: string; otp: string }) {
  return (
    <View style={s.otpRow}>
      <Text style={s.rowLabel}>{label}</Text>
      <View style={s.otpBoxes}>
        {otp.split('').map((d, i) => (
          <View key={i} style={s.otpBox}><Text style={s.otpDigit}>{d}</Text></View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  body: { padding: theme.space.xl, gap: theme.space.md, maxWidth: theme.maxContentWidth },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  h1: { fontSize: theme.font.h1, fontWeight: '800', color: theme.color.text },
  sub: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  refreshBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.borderStrong, backgroundColor: theme.color.surface },
  refreshBtnText: { color: theme.color.text, fontWeight: '600', fontSize: theme.font.small },
  searchInput: { borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md, padding: theme.space.md, fontSize: theme.font.body, color: theme.color.text, backgroundColor: theme.color.surfaceAlt },
  filterRow: { flexDirection: 'row', gap: theme.space.sm },
  filterBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.md, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  filterBtnActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  filterBtnText: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.textMuted },
  filterBtnTextActive: { color: '#fff' },
  error: { color: theme.color.critical, fontSize: theme.font.body },
  empty: { padding: theme.space.xxxl, alignItems: 'center' },
  emptyText: { color: theme.color.textMuted, fontSize: theme.font.body },
  card: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, padding: theme.space.md, gap: theme.space.sm, ...theme.shadow.card },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.space.md },
  cardHeadLeft: { flex: 1, gap: 2 },
  cardHeadRight: { alignItems: 'flex-end', gap: theme.space.xs },
  orderNo: { fontSize: theme.font.tiny, fontWeight: '800', color: theme.color.textFaint, letterSpacing: 0.5 },
  shopName: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  meta: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  total: { fontSize: theme.font.body, fontWeight: '800', color: theme.color.text },
  statusBadge: { paddingVertical: 3, paddingHorizontal: theme.space.sm, borderRadius: theme.radius.pill },
  statusText: { fontSize: theme.font.tiny, fontWeight: '800' },
  detail: { borderTopWidth: 1, borderTopColor: theme.color.border, paddingTop: theme.space.sm, gap: theme.space.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.space.md },
  rowLabel: { fontSize: theme.font.small, color: theme.color.textMuted, fontWeight: '600', flex: 1 },
  rowValue: { fontSize: theme.font.small, color: theme.color.text, fontWeight: '700', flex: 2, textAlign: 'right' },
  rowWarn: { color: theme.color.warning },
  otpRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.space.md },
  otpBoxes: { flexDirection: 'row', gap: theme.space.xs },
  otpBox: { width: 32, height: 38, borderWidth: 2, borderColor: theme.color.primary, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.goodBg },
  otpDigit: { fontSize: theme.font.h3, fontWeight: '900', color: theme.color.primary },
  itemsTitle: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.text, marginTop: theme.space.xs },
  itemRow: { fontSize: theme.font.small, color: theme.color.textMuted },
  loadMore: { alignSelf: 'center', paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  loadMoreText: { color: theme.color.text, fontWeight: '600', fontSize: theme.font.small },
  notice: { maxWidth: 420, padding: theme.space.xl, borderRadius: theme.radius.lg, backgroundColor: theme.color.criticalBg, borderWidth: 1, borderColor: '#FCA5A5', gap: theme.space.sm },
  noticeTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.critical },
  noticeBody: { fontSize: theme.font.body, color: theme.color.text },
});
