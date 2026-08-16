import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';import { ApiError } from '@nearbaz/api-client';
import { api } from '../api';
import { formatRupees, formatRupeesCompact, theme } from '../theme';
import { useLang } from '../i18n/LanguageContext';

interface DashboardStats {
  shops: number;
  activeShops: number;
  totalOrders: number;
  deliveredOrders: number;
  gmvPaise: number;
  nearbazRevenuePaise: number;
  refundPendingCount: number;
  statusCounts: {
    pending: number;
    processing: number;
    completed: number;
    cancelled: number;
    refundPending: number;
    refunded: number;
  };
}

interface RecentOrder {
  orderId: string;
  orderNumber: string;
  status: string;
  totalPaise: number;
  createdAt: string;
  paymentMethod?: string;
  deliveryMode?: string;
  reason?: string | null;
  customer: { name: string | null; phone: string | null } | null;
  shop: { name: string; city?: string | null } | null;
  rider: { name: string | null; phone: string } | null;
  items: Array<{ nameSnapshot: string; qty: number; pricePaiseSnapshot?: number; status?: string }>;
}

type OrderStatusPeriod = 'Today' | 'Weekly' | 'Monthly' | 'Yearly';

/**
 * DashboardScreen — cross-shop KPI stat tiles from GET /admin/dashboard. A 403
 * means the signed-in account is not ADMIN/OWNER (a normal CUSTOMER token), so
 * we surface a clear message instead of a raw error.
 */
export function DashboardScreen() {
  const { t } = useLang();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [statusPeriod, setStatusPeriod] = useState<OrderStatusPeriod>('Today');
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<RecentOrder | null>(null);

  const load = useCallback(async (period: OrderStatusPeriod = statusPeriod) => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const data = await api.adminDashboard(period);
      setStats(data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setForbidden(true);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, [statusPeriod]);

  const loadOrders = useCallback(async (status: string | null) => {
    setOrdersLoading(true);
    try {
      const params: { limit: number; status?: string } = { limit: 20 };
      if (status) params.status = status;
      const res = (await api.adminListOrders(params)) as { items: RecentOrder[] };
      setRecentOrders(res.items ?? []);
    } catch {
      setRecentOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { void loadOrders(selectedStatus); }, [loadOrders, selectedStatus]);

  if (loading && !stats) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.color.accent} size="large" />
      </View>
    );
  }

  if (forbidden) {
    return (
      <View style={styles.center}>
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>{t.common.accessDenied}</Text>
          <Text style={styles.noticeBody}>{t.common.notAdminBody}</Text>
        </View>
      </View>
    );
  }

  if (error || !stats) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? t.dashboard.couldNotLoad}</Text>
        <Pressable style={styles.retry} onPress={() => load()}>
          <Text style={styles.retryText}>{t.common.retry}</Text>
        </Pressable>
      </View>
    );
  }

  const deliveryRate =
    stats.totalOrders > 0
      ? Math.round((stats.deliveredOrders / stats.totalOrders) * 100)
      : 0;
  const inactiveShops = stats.shops - stats.activeShops;
  const nonDelivered = stats.totalOrders - stats.deliveredOrders;
  const avgRevPerOrder = stats.deliveredOrders > 0
    ? Math.round(stats.nearbazRevenuePaise / stats.deliveredOrders)
    : 0;

  const details: Record<string, { label: string; value: string; highlight?: boolean }[]> = {
    shops: [
      { label: 'Total registered', value: String(stats.shops) },
      { label: 'Active (approved)', value: String(stats.activeShops) },
      { label: 'Inactive / suspended', value: String(inactiveShops), highlight: inactiveShops > 0 },
      { label: 'Active rate', value: `${stats.shops > 0 ? Math.round((stats.activeShops / stats.shops) * 100) : 0}%` },
    ],
    orders: [
      { label: 'Total orders', value: String(stats.totalOrders) },
      { label: 'Delivered', value: String(stats.deliveredOrders) },
      { label: 'Not delivered (cancelled/rejected)', value: String(nonDelivered) },
      { label: 'Delivery rate', value: `${deliveryRate}%` },
      { label: 'Refunds pending', value: String(stats.refundPendingCount), highlight: stats.refundPendingCount > 0 },
    ],
    gmv: [
      { label: 'Gross merchandise value', value: formatRupees(stats.gmvPaise) },
      { label: 'Delivered orders', value: String(stats.deliveredOrders) },
      { label: 'Avg order value', value: stats.deliveredOrders > 0 ? formatRupees(Math.round(stats.gmvPaise / stats.deliveredOrders)) : '—' },
    ],
    revenue: [
      { label: 'Total revenue (fees + onboarding)', value: formatRupees(stats.nearbazRevenuePaise) },
      { label: 'Avg per delivered order', value: avgRevPerOrder > 0 ? formatRupees(avgRevPerOrder) : '—' },
      { label: 'GMV take-rate', value: stats.gmvPaise > 0 ? `${(stats.nearbazRevenuePaise / stats.gmvPaise * 100).toFixed(1)}%` : '—' },
    ],
    refunds: [
      { label: 'Refunds pending', value: String(stats.refundPendingCount), highlight: stats.refundPendingCount > 0 },
      { label: 'Action required', value: stats.refundPendingCount > 0 ? 'Go to Disputes tab' : 'None' },
    ],
  };

  const detailTitle: Record<string, string> = {
    shops: 'Shop breakdown',
    orders: 'Order breakdown',
    gmv: 'GMV breakdown',
    revenue: 'Revenue breakdown',
    refunds: 'Refunds',
  };

  const activeDetail = expanded ? details[expanded] : null;

  function toggle(key: string) {
    setExpanded((prev) => (prev === key ? null : key));
  }

  // Order status counts — real per-status buckets from the API, scoped to the
  // admin's city + selected period.
  const sc = stats.statusCounts;

  const STATUS_PERIODS: OrderStatusPeriod[] = ['Today', 'Weekly', 'Monthly', 'Yearly'];

  return (
    <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.h1}>{t.dashboard.title}</Text>
          <Text style={styles.sub}>{t.dashboard.subtitle}</Text>
        </View>
        <Pressable style={styles.refresh} onPress={() => load()}>
          <Text style={styles.refreshText}>{t.common.refresh}</Text>
        </Pressable>
      </View>

      {/* Summary stat tiles */}
      <SectionBlock title="Summary">
        <View style={styles.grid}>
          <StatTile
            tileKey="shops" label={t.dashboard.activeShops} value={String(stats.activeShops)}
            hint={t.dashboard.activeShopsHint(stats.shops)} accentColor="#15803D"
            selected={expanded === 'shops'} onPress={() => toggle('shops')}
          />
          <StatTile
            tileKey="orders" label={t.dashboard.totalOrders}
            value={stats.totalOrders.toLocaleString('en-IN')} hint={t.dashboard.totalOrdersHint}
            accentColor="#7C3AED"
            selected={expanded === 'orders'} onPress={() => toggle('orders')}
          />
          <StatTile
            tileKey="gmv" label={t.dashboard.gmv} value={formatRupeesCompact(stats.gmvPaise)}
            hint={formatRupees(stats.gmvPaise)} accentColor="#1D4ED8" wide
            selected={expanded === 'gmv'} onPress={() => toggle('gmv')}
          />
          <StatTile
            tileKey="revenue" label={t.dashboard.nearbazRevenue}
            value={formatRupeesCompact(stats.nearbazRevenuePaise)}
            hint={t.dashboard.revenueHint(formatRupees(stats.nearbazRevenuePaise))}
            accentColor={theme.color.accent} wide
            selected={expanded === 'revenue'} onPress={() => toggle('revenue')}
          />
          <StatTile
            tileKey="refunds" label={t.dashboard.refundsPending}
            value={String(stats.refundPendingCount)}
            hint={stats.refundPendingCount > 0 ? t.dashboard.needsAttention : t.dashboard.allClear}
            accentColor={stats.refundPendingCount > 0 ? theme.color.warning : theme.color.good}
            selected={expanded === 'refunds'} onPress={() => toggle('refunds')}
          />
        </View>
      </SectionBlock>

      {/* Detail panel */}
      {activeDetail && expanded ? (
        <View style={styles.detailPanel}>
          <Text style={styles.detailTitle}>{detailTitle[expanded]}</Text>
          <View style={styles.detailTable}>
            {activeDetail.map((row, i) => (
              <View key={i} style={[styles.detailRow, i > 0 && styles.detailRowBorder]}>
                <Text style={styles.detailLabel}>{row.label}</Text>
                <Text style={[styles.detailValue, row.highlight && styles.detailHighlight]}>
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Order Status section with period tabs */}
      <SectionBlock
        title="Order Status"
        headerRight={
          <View style={styles.periodTabs}>
            {STATUS_PERIODS.map((p) => (
              <Pressable
                key={p}
                onPress={() => { setStatusPeriod(p); setSelectedStatus(null); load(p); void loadOrders(null); }}
                style={[styles.periodTab, statusPeriod === p && styles.periodTabActive]}
              >
                <Text style={[styles.periodTabText, statusPeriod === p && styles.periodTabTextActive]}>
                  {p}
                </Text>
              </Pressable>
            ))}
          </View>
        }
      >
        <View style={styles.statusGrid}>
          <OrderStatusTile label="Pending Order"    value={sc.pending}      accentColor="#3B82F6" statusKey="PLACED,ACCEPTED,AWAITING_PAYMENT"                        selected={selectedStatus === 'PLACED,ACCEPTED,AWAITING_PAYMENT'}                        onPress={setSelectedStatus} />
          <OrderStatusTile label="Processing Order" value={sc.processing}   accentColor="#8B5CF6" statusKey="PREPARING,READY,RIDER_ASSIGNED,OUT_FOR_DELIVERY"           selected={selectedStatus === 'PREPARING,READY,RIDER_ASSIGNED,OUT_FOR_DELIVERY'}           onPress={setSelectedStatus} />
          <OrderStatusTile label="Completed Order"  value={sc.completed}    accentColor="#10B981" statusKey="DELIVERED"                                                  selected={selectedStatus === 'DELIVERED'}                                                  onPress={setSelectedStatus} />
          <OrderStatusTile label="Cancelled Order"  value={sc.cancelled}    accentColor="#EF4444" statusKey="REJECTED,CANCELLED"                                        selected={selectedStatus === 'REJECTED,CANCELLED'}                                        onPress={setSelectedStatus} />
          <OrderStatusTile label="Refund Pending"   value={sc.refundPending} accentColor="#F59E0B" statusKey="REFUND_PENDING"                                           selected={selectedStatus === 'REFUND_PENDING'}                                            onPress={setSelectedStatus} />
          <OrderStatusTile label="Refunded"         value={sc.refunded}     accentColor="#14B8A6" statusKey="REFUNDED"                                                  selected={selectedStatus === 'REFUNDED'}                                                  onPress={setSelectedStatus} />
        </View>
      </SectionBlock>

      {/* Recent Orders table */}
      <SectionBlock
        title={selectedStatus ? `${selectedStatus.replace(/_/g, ' ')} Orders` : 'Recent Orders'}
        headerRight={
          selectedStatus ? (
            <Pressable onPress={() => setSelectedStatus(null)} style={styles.clearFilterBtn}>
              <Text style={styles.clearFilterText}>✕ Show all</Text>
            </Pressable>
          ) : undefined
        }
      >
        <View style={styles.table}>
          {/* Table header */}
          <View style={[styles.tableRow, styles.tableHead]}>
            <Text style={[styles.tableCell, styles.tableHCell, { flex: 2 }]}>Tracking Number</Text>
            <Text style={[styles.tableCell, styles.tableHCell, { flex: 2 }]}>Customer</Text>
            <Text style={[styles.tableCell, styles.tableHCell, { flex: 2 }]}>Products</Text>
            <Text style={[styles.tableCell, styles.tableHCell, { flex: 2 }]}>Order Date</Text>
            <Text style={[styles.tableCell, styles.tableHCell, { flex: 1.5 }]}>Total</Text>
            <Text style={[styles.tableCell, styles.tableHCell, { flex: 1.5 }]}>Status</Text>
          </View>
          {ordersLoading ? (
            <View style={styles.tableEmpty}>
              <ActivityIndicator color={theme.color.accent} />
            </View>
          ) : recentOrders.length === 0 ? (
            <View style={styles.tableEmpty}>
              <Text style={styles.tableEmptyText}>{selectedStatus ? `No ${selectedStatus.replace(/_/g, ' ').toLowerCase()} orders` : 'No orders yet'}</Text>
            </View>
          ) : (
            recentOrders.map((order, i) => {
              const sc = STATUS_COLORS[order.status] ?? { bg: '#F1F5F9', fg: '#64748B' };
              const itemCount = order.items.reduce((s, it) => s + it.qty, 0);
              const customerName = order.customer?.name ?? order.customer?.phone ?? '—';
              const initials = customerName !== '—'
                ? customerName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                : '?';
              return (
                <Pressable key={order.orderId} onPress={() => setSelectedOrder(order)}
                  style={({ pressed }) => [styles.tableRow, i % 2 === 1 && styles.tableRowAlt, pressed && { opacity: 0.7 }]}>
                  <View style={[styles.tableCell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                    <View style={styles.orderIdBox}>
                      <Text style={styles.orderIdBoxText}>□</Text>
                    </View>
                    <Text style={styles.orderNum} numberOfLines={1}>
                      {order.orderNumber ?? order.orderId.slice(0, 16).toUpperCase()}
                    </Text>
                  </View>
                  <View style={[styles.tableCell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initials}</Text>
                    </View>
                    <Text style={styles.customerName} numberOfLines={1}>{customerName}</Text>
                  </View>
                  <Text style={[styles.tableCell, styles.tableCellText, { flex: 2 }]}>{itemCount} item{itemCount !== 1 ? 's' : ''}</Text>
                  <Text style={[styles.tableCell, styles.tableCellText, { flex: 2 }]}>{fmtDate(order.createdAt)}</Text>
                  <Text style={[styles.tableCell, styles.tableCellText, { flex: 1.5, fontWeight: '700' }]}>
                    {formatRupees(order.totalPaise)}
                  </Text>
                  <View style={[styles.tableCell, { flex: 1.5 }]}>
                    <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                      <Text style={[styles.statusBadgeText, { color: sc.fg }]}>
                        {order.status.charAt(0) + order.status.slice(1).toLowerCase().replace(/_/g, ' ')}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      </SectionBlock>
    </ScrollView>

    <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
    </View>
  );
}

function OrderDetailModal({ order, onClose }: { order: RecentOrder | null; onClose: () => void }) {
  if (!order) return null;
  const sc = STATUS_COLORS[order.status] ?? { bg: '#F1F5F9', fg: '#64748B' };
  const customerName = order.customer?.name ?? order.customer?.phone ?? '—';
  const statusLabel = order.status.charAt(0) + order.status.slice(1).toLowerCase().replace(/_/g, ' ');
  const payLabel = order.paymentMethod === 'COD' ? 'Cash on Delivery' : order.paymentMethod === 'UPI_DIRECT' ? 'UPI (direct)' : order.paymentMethod ?? '—';
  const delivLabel = order.deliveryMode === 'SELF_PICKUP' ? 'Self Pickup' : order.deliveryMode === 'PLATFORM_RIDER' ? 'Rider Delivery' : 'Shop Delivery';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <ScrollView style={{ width: '100%' }} contentContainerStyle={{ alignItems: 'center', padding: 24 }}>
        <Pressable style={styles.modalCard} onPress={() => {}}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalOrderId}>#{(order.orderNumber ?? order.orderId).toUpperCase()}</Text>
              <Text style={styles.modalDate}>{fmtDate(order.createdAt)}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.statusBadgeText, { color: sc.fg }]}>{statusLabel}</Text>
            </View>
          </View>

          {/* Payment + delivery */}
          <View style={styles.modalMetaRow}>
            <Text style={styles.modalMetaChip}>{payLabel}</Text>
            <Text style={styles.modalMetaChip}>{delivLabel}</Text>
          </View>

          {/* Customer */}
          <View style={styles.modalSection}>
            <Text style={styles.modalLabel}>Customer</Text>
            <Text style={styles.modalValue}>{customerName}</Text>
            {order.customer?.phone ? <Text style={styles.modalSub}>{order.customer.phone}</Text> : null}
          </View>

          {/* Shop */}
          {order.shop ? (
            <View style={styles.modalSection}>
              <Text style={styles.modalLabel}>Shop</Text>
              <Text style={styles.modalValue}>{order.shop.name}</Text>
              {order.shop.city ? <Text style={styles.modalSub}>{order.shop.city}</Text> : null}
            </View>
          ) : null}

          {/* Rider */}
          {order.rider ? (
            <View style={styles.modalSection}>
              <Text style={styles.modalLabel}>Rider</Text>
              <Text style={styles.modalValue}>{order.rider.name ?? 'Unknown'}</Text>
              <Text style={styles.modalSub}>{order.rider.phone}</Text>
            </View>
          ) : null}

          {/* Cancellation / rejection reason */}
          {order.reason ? (
            <View style={[styles.modalSection, { backgroundColor: '#FEF2F2', borderRadius: 8, padding: 8 }]}>
              <Text style={styles.modalLabel}>Reason</Text>
              <Text style={[styles.modalValue, { color: theme.color.critical }]}>{order.reason}</Text>
            </View>
          ) : null}

          {/* Items */}
          <View style={styles.modalSection}>
            <Text style={styles.modalLabel}>Items</Text>
            {order.items.map((it, i) => {
              const unavail = it.status === 'UNAVAILABLE';
              return (
                <View key={i} style={styles.modalItemRow}>
                  <Text style={[styles.modalItemName, unavail && { color: theme.color.textFaint, textDecorationLine: 'line-through' }]} numberOfLines={2}>{it.nameSnapshot}</Text>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    {unavail
                      ? <Text style={{ color: theme.color.critical, fontSize: theme.font.tiny, fontWeight: '700' }}>removed</Text>
                      : <Text style={styles.modalItemQty}>×{it.qty}</Text>
                    }
                    {it.pricePaiseSnapshot ? <Text style={styles.modalSub}>{formatRupees(it.pricePaiseSnapshot * it.qty)}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>

          {/* Total */}
          <View style={styles.modalTotalRow}>
            <Text style={styles.modalTotalLabel}>Order Total</Text>
            <Text style={styles.modalTotal}>{formatRupees(order.totalPaise)}</Text>
          </View>

          <Pressable style={styles.modalCloseBtn} onPress={onClose}>
            <Text style={styles.modalCloseBtnText}>Close</Text>
          </Pressable>
        </Pressable>
        </ScrollView>
      </Pressable>
    </Modal>
  );
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
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today, ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff} days ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function SectionBlock({
  title,
  headerRight,
  children,
}: {
  title: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleBar} />
        <Text style={styles.sectionTitle}>{title}</Text>
        {headerRight ? <View style={styles.sectionHeaderRight}>{headerRight}</View> : null}
      </View>
      {children}
    </View>
  );
}

function StatTile({
  tileKey: _key,
  label,
  value,
  hint,
  accentColor,
  wide,
  selected,
  onPress,
}: {
  tileKey: string;
  label: string;
  value: string;
  hint?: string;
  accentColor: string;
  wide?: boolean;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.tile,
        wide && styles.tileWide,
        selected && styles.tileSelected,
        pressed && styles.tilePressed,
      ]}
      onPress={onPress}
    >
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
      {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
      {/* Bottom colored bar */}
      <View style={[styles.tileBottomBar, { backgroundColor: accentColor }]} />
    </Pressable>
  );
}

function OrderStatusTile({
  label,
  value,
  accentColor,
  statusKey,
  selected,
  onPress,
}: {
  label: string;
  value: number;
  accentColor: string;
  statusKey: string;
  selected: boolean;
  onPress: (key: string | null) => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.statusTile,
        { borderBottomColor: accentColor },
        selected && { backgroundColor: accentColor + '18', borderColor: accentColor, borderWidth: 1.5 },
        pressed && { opacity: 0.8 },
      ]}
      onPress={() => onPress(selected ? null : statusKey)}
    >
      <Text style={[styles.statusTileValue, selected && { color: accentColor }]}>{value}</Text>
      <Text style={[styles.statusTileLabel, selected && { color: accentColor, fontWeight: '700' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { padding: theme.space.xl, gap: theme.space.xl, paddingBottom: theme.space.xxxl },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space.xl,
    gap: theme.space.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  h1: { fontSize: theme.font.h1, fontWeight: '800', color: theme.color.text },
  sub: { fontSize: theme.font.body, color: theme.color.textMuted, marginTop: 2 },
  refresh: {
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.lg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    backgroundColor: theme.color.surface,
  },
  refreshText: { color: theme.color.text, fontWeight: '600', fontSize: theme.font.small },

  // Section block
  sectionBlock: { gap: theme.space.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  sectionTitleBar: { width: 4, height: 20, borderRadius: 2, backgroundColor: theme.color.accent },
  sectionTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text, flex: 1 },
  sectionHeaderRight: { alignItems: 'flex-end' },
  clearFilterBtn: { paddingVertical: 4, paddingHorizontal: theme.space.md, borderRadius: theme.radius.pill, backgroundColor: theme.color.infoBg, borderWidth: 1, borderColor: theme.color.info },
  clearFilterText: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.info },

  // Period tabs
  periodTabs: { flexDirection: 'row', backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: 3, gap: 2, borderWidth: 1, borderColor: theme.color.border },
  periodTab: { paddingVertical: 5, paddingHorizontal: theme.space.md, borderRadius: theme.radius.sm },
  periodTabActive: { backgroundColor: theme.color.accent },
  periodTabText: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  periodTabTextActive: { color: '#fff' },

  // Summary grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.lg,
  },
  tile: {
    flexGrow: 1, flexBasis: 180, minWidth: 160,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.lg,
    paddingBottom: theme.space.xl,
    overflow: 'hidden',
    ...theme.shadow.card,
    gap: 4,
  },
  tileWide: { flexBasis: 260 },
  tileSelected: { borderColor: theme.color.accent },
  tilePressed: { opacity: 0.85 },
  tileLabel: {
    fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  tileValue: {
    fontSize: theme.font.display, fontWeight: '800', color: theme.color.text,
    marginTop: theme.space.xs,
  },
  tileHint: { fontSize: theme.font.small, color: theme.color.textFaint, marginTop: 2 },
  tileBottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 4 },

  // Order Status tiles
  statusGrid: { flexDirection: 'row', gap: theme.space.lg, flexWrap: 'wrap' },
  statusTile: {
    flexGrow: 1, flexBasis: 180, minWidth: 160,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderBottomWidth: 3,
    padding: theme.space.lg,
    gap: 4,
    alignItems: 'flex-start',
    ...theme.shadow.card,
  },
  statusTileValue: { fontSize: theme.font.display, fontWeight: '800', color: theme.color.text },
  statusTileLabel: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },

  // Detail panel
  detailPanel: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.accent,
    padding: theme.space.lg,
    gap: theme.space.sm,
    ...theme.shadow.card,
  },
  detailTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text, marginBottom: theme.space.xs },
  detailTable: { gap: 0 },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: theme.space.sm,
  },
  detailRowBorder: { borderTopWidth: 1, borderTopColor: theme.color.border },
  detailLabel: { fontSize: theme.font.body, color: theme.color.textMuted, flex: 1 },
  detailValue: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  detailHighlight: { color: theme.color.warning },

  // Recent Orders table
  table: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    overflow: 'hidden',
    ...theme.shadow.card,
  },
  tableHead: { backgroundColor: theme.color.surfaceAlt },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  tableRowAlt: { backgroundColor: theme.color.surfaceAlt },
  tableCell: { paddingHorizontal: 4 },
  tableHCell: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 },
  tableCellText: { fontSize: theme.font.small, color: theme.color.text },
  tableEmpty: { padding: theme.space.xl, alignItems: 'center' },
  tableEmptyText: { color: theme.color.textFaint, fontSize: theme.font.body },
  orderIdBox: { width: 18, height: 18, borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  orderIdBoxText: { fontSize: 10, color: theme.color.textFaint },
  orderNum: { fontSize: theme.font.small, color: theme.color.text, fontWeight: '600', fontFamily: 'monospace' },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.color.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: theme.font.tiny, fontWeight: '800', color: '#fff' },
  customerName: { fontSize: theme.font.small, color: theme.color.text, fontWeight: '500', flex: 1 },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: theme.space.sm, paddingVertical: 3, borderRadius: theme.radius.pill },
  statusBadgeText: { fontSize: theme.font.tiny, fontWeight: '700' },

  notice: {
    maxWidth: 420,
    padding: theme.space.xl,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.criticalBg,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    gap: theme.space.sm,
  },
  noticeTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.critical },
  noticeBody: { fontSize: theme.font.body, color: theme.color.text, lineHeight: 21 },
  error: { color: theme.color.critical, fontSize: theme.font.body },
  retry: {
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.lg,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.primary,
  },
  retryText: { color: '#fff', fontWeight: '700' },

  // Order detail modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 440, backgroundColor: theme.color.surface, borderRadius: 16, padding: 20, gap: 16 },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  modalOrderId: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  modalDate: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  modalSection: { gap: 6 },
  modalLabel: { fontSize: theme.font.tiny, fontWeight: '800', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  modalValue: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  modalSub: { fontSize: theme.font.small, color: theme.color.textMuted },
  modalItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalItemName: { flex: 1, fontSize: theme.font.body, color: theme.color.text },
  modalItemQty: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.textMuted },
  modalTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: theme.color.border, paddingTop: 12 },
  modalTotalLabel: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  modalTotal: { fontSize: theme.font.h3, fontWeight: '900', color: theme.color.primary },
  modalCloseBtn: { backgroundColor: theme.color.surfaceAlt, borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: theme.color.border },
  modalCloseBtnText: { fontWeight: '700', color: theme.color.textMuted, fontSize: theme.font.body },
  modalMetaRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  modalMetaChip: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textMuted, backgroundColor: theme.color.surfaceAlt, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1, borderColor: theme.color.border },
});
