import { useCallback, useEffect, useRef, useState } from 'react';
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
  extraDeliveryDuePaise: number;
  paymentConfirmed: boolean;
  paymentClaimedAt: string | null;
  codUpiClaimedAt: string | null;
  cancelledBy: string | null;
  reason: string | null;
  pickupOtp: string | null;
  riderPickupOtp: string | null;
  additionalRiderIds: string[];
  shop: { id: string; shortId?: string | null; name: string; city: string } | null;
  customer: { id: string; shortId?: string | null; name: string | null; phone: string | null } | null;
  rider: { id: string; shortId?: string | null; name: string | null; phone: string | null } | null;
  items: Array<{ id: string; nameSnapshot: string; qty: number; pricePaiseSnapshot: number; status: string }>;
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

  // Per-order action state
  const [riderInput, setRiderInput] = useState<Record<string, string>>({});
  const [riderBusy, setRiderBusy] = useState<Record<string, boolean>>({});
  const [riderMsg, setRiderMsg] = useState<Record<string, string>>({});
  const [feeInput, setFeeInput] = useState<Record<string, string>>({});
  const [feeBusy, setFeeBusy] = useState<Record<string, boolean>>({});
  const [feeMsg, setFeeMsg] = useState<Record<string, string>>({});
  const [partialItems, setPartialItems] = useState<Record<string, Set<number>>>({});
  const [partialMsg, setPartialMsg] = useState<Record<string, string>>({});

  // Initialise fee input when an order is expanded
  const prevExpanded = useRef<string | null>(null);
  useEffect(() => {
    if (expanded && expanded !== prevExpanded.current) {
      const o = orders.find(x => x.orderId === expanded);
      if (o) setFeeInput(prev => ({ ...prev, [expanded]: String(Math.round(o.deliveryFeePaise / 100)) }));
    }
    prevExpanded.current = expanded;
  }, [expanded, orders]);

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

  async function assignRiders(orderId: string) {
    const raw = (riderInput[orderId] ?? '').trim();
    if (!raw) return;
    const ids = raw.split(/[\s,]+/).filter(Boolean);
    setRiderBusy(p => ({ ...p, [orderId]: true }));
    setRiderMsg(p => ({ ...p, [orderId]: '' }));
    try {
      const res = await api.adminAssignAdditionalRiders(orderId, ids);
      setOrders(prev => prev.map(o => o.orderId === orderId ? { ...o, additionalRiderIds: res.additionalRiderIds } : o));
      setRiderInput(p => ({ ...p, [orderId]: '' }));
      setRiderMsg(p => ({ ...p, [orderId]: `Assigned ${res.additionalRiderIds.length} rider(s)` }));
    } catch (e) {
      setRiderMsg(p => ({ ...p, [orderId]: (e as Error).message }));
    } finally {
      setRiderBusy(p => ({ ...p, [orderId]: false }));
    }
  }

  async function updateDeliveryFee(orderId: string) {
    const raw = (feeInput[orderId] ?? '').trim();
    const rupees = parseFloat(raw);
    if (isNaN(rupees) || rupees < 0) {
      setFeeMsg(p => ({ ...p, [orderId]: 'Enter a valid amount in rupees' }));
      return;
    }
    const paise = Math.round(rupees * 100);
    setFeeBusy(p => ({ ...p, [orderId]: true }));
    setFeeMsg(p => ({ ...p, [orderId]: '' }));
    try {
      const res = await api.adminUpdateOrderDeliveryFee(orderId, paise);
      setOrders(prev => prev.map(o => o.orderId === orderId
        ? { ...o, deliveryFeePaise: res.deliveryFeePaise, extraDeliveryDuePaise: res.extraDeliveryDuePaise }
        : o));
      const note = res.isPrepaid && res.extraDeliveryDuePaise > 0
        ? ` · ₹${(res.extraDeliveryDuePaise / 100).toFixed(2)} due at delivery`
        : '';
      setFeeMsg(p => ({ ...p, [orderId]: `Updated to ₹${(res.deliveryFeePaise / 100).toFixed(2)}${note}` }));
    } catch (e) {
      setFeeMsg(p => ({ ...p, [orderId]: (e as Error).message }));
    } finally {
      setFeeBusy(p => ({ ...p, [orderId]: false }));
    }
  }

  async function markPartialDelivery(orderId: string, orderItems: AdminOrder['items']) {
    const selectedIndices = partialItems[orderId] ?? new Set(orderItems.map((_, j) => j));
    const fulfilledItemIds = orderItems
      .filter((_, i) => selectedIndices.has(i))
      .map(it => it.id);
    if (fulfilledItemIds.length === 0) {
      setPartialMsg(p => ({ ...p, [orderId]: 'Select at least one fulfilled item' }));
      return;
    }
    setPartialMsg(p => ({ ...p, [orderId]: '' }));
    try {
      const res = await api.adminMarkPartialDelivery(orderId, fulfilledItemIds);
      setOrders(prev => prev.map(o => o.orderId === orderId ? { ...o, status: 'DELIVERED' } : o));
      setPartialMsg(p => ({ ...p, [orderId]: `Partial delivery recorded — ${res.removedCount} item(s) removed, adjusted total ₹${(res.adjustedTotalPaise / 100).toFixed(2)}` }));
    } catch (e) {
      setPartialMsg(p => ({ ...p, [orderId]: (e as Error).message }));
    }
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
            <View key={o.orderId} style={s.card}>
              <Pressable style={s.cardHead} onPress={() => setExpanded(open ? null : o.orderId)}>
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
              </Pressable>

              {open ? (
                <View style={s.detail}>
                  {/* Parties */}
                  <Row label="Shop" value={`${o.shop?.shortId ?? ''} · ${o.shop?.name ?? '—'}${o.shop?.city ? ` · ${o.shop.city}` : ''}`} />
                  <Row label="Customer" value={`${o.customer?.shortId ?? ''} · ${o.customer?.name ?? '—'} · ${o.customer?.phone ?? ''}`} />
                  {o.rider ? <Row label="Rider" value={`${o.rider.shortId ?? ''} · ${o.rider.name ?? '—'} · ${o.rider.phone ?? ''}`} /> : null}
                  {o.additionalRiderIds.length > 0
                    ? <Row label="Additional riders" value={o.additionalRiderIds.join(', ')} />
                    : null}

                  {/* Money */}
                  <Row label="Payment" value={`${o.paymentMethod} · ${o.deliveryMode}`} />
                  <Row label="Total" value={formatRupees(o.totalPaise)} />
                  <Row label="Platform fee" value={formatRupees(o.platformFeePaise)} />
                  <Row label="Delivery fee" value={formatRupees(o.deliveryFeePaise)} />
                  {o.extraDeliveryDuePaise > 0
                    ? <Row label="Due at delivery" value={formatRupees(o.extraDeliveryDuePaise)} warn />
                    : null}
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
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={[s.itemRow, it.status === 'UNAVAILABLE' && { textDecorationLine: 'line-through', color: theme.color.textFaint }]}>
                        {it.qty}× {it.nameSnapshot} — {formatRupees(it.pricePaiseSnapshot)}
                      </Text>
                      {it.status === 'UNAVAILABLE' ? (
                        <Text style={{ fontSize: theme.font.tiny, fontWeight: '700', color: '#DC2626', marginLeft: 8 }}>REMOVED</Text>
                      ) : null}
                    </View>
                  ))}

                  {/* Admin actions (live orders only) */}
                  {isLive(o.status) ? (
                    <View style={s.actionsBlock}>
                      {/* Assign additional riders */}
                      <Text style={s.actionTitle}>Assign additional riders</Text>
                      <Text style={s.actionHint}>Paste rider user IDs separated by comma or space</Text>
                      <View style={s.actionRow}>
                        <TextInput
                          style={[s.actionInput, { flex: 1 }]}
                          placeholder="rider-id-1, rider-id-2"
                          placeholderTextColor={theme.color.textFaint}
                          value={riderInput[o.orderId] ?? ''}
                          onChangeText={v => setRiderInput(p => ({ ...p, [o.orderId]: v }))}
                          autoCorrect={false}
                          autoCapitalize="none"
                        />
                        <Pressable
                          style={[s.actionBtn, riderBusy[o.orderId] && s.actionBtnDisabled]}
                          onPress={() => assignRiders(o.orderId)}
                          disabled={riderBusy[o.orderId]}
                        >
                          {riderBusy[o.orderId]
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <Text style={s.actionBtnText}>Assign</Text>}
                        </Pressable>
                      </View>
                      {riderMsg[o.orderId] ? (
                        <Text style={[s.actionFeedback, riderMsg[o.orderId]?.startsWith('Assigned') && s.actionFeedbackOk]}>
                          {riderMsg[o.orderId]}
                        </Text>
                      ) : null}

                      {/* Edit delivery fee */}
                      <Text style={[s.actionTitle, { marginTop: theme.space.md }]}>Delivery fee</Text>
                      {o.paymentMethod === 'UPI_DIRECT' && o.paymentConfirmed ? (
                        <Text style={s.actionHint}>Prepaid order — any increase will be collected by rider at delivery</Text>
                      ) : (
                        <Text style={s.actionHint}>COD order — fee update applies directly</Text>
                      )}
                      <View style={s.actionRow}>
                        <TextInput
                          style={[s.actionInput, { flex: 1 }]}
                          placeholder="Amount in ₹"
                          placeholderTextColor={theme.color.textFaint}
                          keyboardType="decimal-pad"
                          value={feeInput[o.orderId] ?? ''}
                          onChangeText={v => setFeeInput(p => ({ ...p, [o.orderId]: v }))}
                        />
                        <Pressable
                          style={[s.actionBtn, feeBusy[o.orderId] && s.actionBtnDisabled]}
                          onPress={() => updateDeliveryFee(o.orderId)}
                          disabled={feeBusy[o.orderId]}
                        >
                          {feeBusy[o.orderId]
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <Text style={s.actionBtnText}>Update</Text>}
                        </Pressable>
                      </View>
                      {feeMsg[o.orderId] ? (
                        <Text style={[s.actionFeedback, feeMsg[o.orderId]?.startsWith('Updated') && s.actionFeedbackOk]}>
                          {feeMsg[o.orderId]}
                        </Text>
                      ) : null}

                      {/* Partial delivery */}
                      {o.status === 'OUT_FOR_DELIVERY' || o.status === 'DELIVERED' ? (
                        <View style={{ marginTop: theme.space.md }}>
                          <Text style={s.actionTitle}>Partial delivery</Text>
                          <Text style={s.actionHint}>Tick the items that were actually delivered, then confirm</Text>
                          {o.items.map((it, i) => (
                            <Pressable
                              key={i}
                              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}
                              onPress={() => {
                                setPartialItems(prev => {
                                  const next = new Set(prev[o.orderId] ?? o.items.map((_, j) => j));
                                  if (next.has(i)) next.delete(i); else next.add(i);
                                  return { ...prev, [o.orderId]: next };
                                });
                              }}
                            >
                              <Text style={{ fontSize: 16 }}>{(partialItems[o.orderId] ?? new Set(o.items.map((_, j) => j))).has(i) ? '☑' : '☐'}</Text>
                              <Text style={s.rowValue}>{it.qty}× {it.nameSnapshot}</Text>
                            </Pressable>
                          ))}
                          <Pressable
                            style={[s.actionBtn, s.actionBtnDisabled]}
                            onPress={() => markPartialDelivery(o.orderId, o.items)}
                          >
                            <Text style={s.actionBtnText}>Mark partial delivery</Text>
                          </Pressable>
                          {partialMsg[o.orderId] ? <Text style={s.actionFeedback}>{partialMsg[o.orderId]}</Text> : null}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
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
  actionsBlock: { borderTopWidth: 1, borderTopColor: theme.color.border, paddingTop: theme.space.md, gap: theme.space.sm },
  actionTitle: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.text, textTransform: 'uppercase', letterSpacing: 0.3 },
  actionHint: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  actionRow: { flexDirection: 'row', gap: theme.space.sm, alignItems: 'center' },
  actionInput: { borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md, paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm, fontSize: theme.font.small, color: theme.color.text, backgroundColor: theme.color.surfaceAlt },
  actionBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, alignItems: 'center', justifyContent: 'center', minWidth: 72 },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.small },
  actionFeedback: { fontSize: theme.font.tiny, color: theme.color.critical, fontWeight: '600' },
  actionFeedbackOk: { color: theme.color.good },
});
