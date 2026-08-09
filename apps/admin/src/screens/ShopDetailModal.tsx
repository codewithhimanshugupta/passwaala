import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '../api';
import { formatRupees, formatRupeesCompact, theme } from '../theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShopDetail {
  id: string;
  shortId?: string | null;
  name: string;
  shopCategory: string;
  city: string;
  addressLine?: string | null;
  contactPhone?: string | null;
  gstin?: string | null;
  legalName?: string | null;
  stateCode?: string | null;
  upiVpa?: string | null;
  verificationStatus: string;
  isOpen: boolean;
  commissionRate: number;
  commissionFreeUntil?: string | null;
  creditLimitPaise: number;
  outstandingDuesPaise: number;
  minOrderValuePaise: number;
  deliveryFeePaise: number;
  freeDeliveryAbovePaise?: number | null;
  platformDeliveryEnabled: boolean;
  selfPickupEnabled: boolean;
  offerText?: string | null;
  avgRating: number;
  ratingCount: number;
  ownerLoginPin?: string | null;
  createdAt: string;
  kyc?: {
    aadhaarPan?: string | null;
    gstOrLicence?: string | null;
    fssai?: string | null;
    bankProofUrl?: string | null;
    docUrls?: string[] | null;
    createdAt?: string | null;
  } | null;
  products: Array<{
    id: string;
    name: string;
    pricePaise: number;
    mrpPaise?: number | null;
    stock: number;
    available: boolean;
    orderCount: number;
    imageUrl?: string | null;
    createdAt: string;
  }>;
  recentOrders: Array<{
    orderId: string;
    orderNumber: string;
    status: string;
    totalPaise: number;
    paymentMethod?: string | null;
    reason?: string | null;
    customer?: { name?: string | null; phone?: string | null } | null;
    itemCount: number;
    createdAt: string;
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  PLACED:           { bg: '#EFF6FF', fg: '#1D4ED8' },
  ACCEPTED:         { bg: '#ECFDF5', fg: '#065F46' },
  AWAITING_PAYMENT: { bg: '#FEF3C7', fg: '#92400E' },
  PREPARING:        { bg: '#EDE9FE', fg: '#5B21B6' },
  READY:            { bg: '#ECFDF5', fg: '#065F46' },
  RIDER_ASSIGNED:   { bg: '#DBEAFE', fg: '#1E40AF' },
  OUT_FOR_DELIVERY: { bg: '#FEF9C3', fg: '#713F12' },
  DELIVERED:        { bg: '#D1FAE5', fg: '#065F46' },
  CANCELLED:        { bg: '#FEE2E2', fg: '#991B1B' },
  REJECTED:         { bg: '#FEE2E2', fg: '#991B1B' },
  REFUND_PENDING:   { bg: '#FEF3C7', fg: '#92400E' },
  REFUNDED:         { bg: '#D1FAE5', fg: '#065F46' },
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: diff > 365 ? '2-digit' : undefined });
}

function statusLabel(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
}

function ratePct(rate: number) {
  const pct = rate * 100;
  return Number.isInteger(pct) ? `${pct}%` : `${Number(pct.toFixed(2))}%`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={s.sectionHeader}>
      <View style={s.sectionBar} />
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
  );
}

function Row({ label, value, warn, mono }: { label: string; value: string; warn?: boolean; mono?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, warn && { color: theme.color.warning }, mono && { fontFamily: 'monospace' }]}>{value}</Text>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ShopDetailModal({ shopId, shopName, onClose }: {
  shopId: string | null;
  shopName?: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ShopDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'products' | 'orders' | 'kyc'>('overview');

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = (await api.adminShopDetail(id)) as ShopDetail;
      setDetail(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (shopId) {
      setDetail(null);
      setTab('overview');
      void load(shopId);
    }
  }, [shopId, load]);

  if (!shopId) return null;

  const TABS: { key: typeof tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'products', label: `Products${detail ? ` (${detail.products.length})` : ''}` },
    { key: 'orders',   label: `Orders${detail ? ` (${detail.recentOrders.length})` : ''}` },
    { key: 'kyc',      label: 'KYC' },
  ];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.card} onPress={() => {}}>
          {/* Header */}
          <View style={s.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.modalTitle} numberOfLines={1}>{detail?.name ?? shopName ?? '…'}</Text>
              <Text style={s.modalSub}>{detail?.city}{detail?.shopCategory ? ` · ${detail.shopCategory}` : ''}</Text>
            </View>
            {detail ? (
              <View style={[s.statusBadge, { backgroundColor: detail.isOpen ? '#D1FAE5' : '#F1F5F9' }]}>
                <View style={[s.dot, { backgroundColor: detail.isOpen ? theme.color.good : theme.color.textFaint }]} />
                <Text style={[s.statusBadgeText, { color: detail.isOpen ? theme.color.good : theme.color.textFaint }]}>
                  {detail.isOpen ? 'Open' : 'Closed'}
                </Text>
              </View>
            ) : null}
            <Pressable style={s.closeBtn} onPress={onClose} hitSlop={8}>
              <Text style={s.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          {/* Tabs */}
          <View style={s.tabs}>
            {TABS.map((t) => (
              <Pressable key={t.key} onPress={() => setTab(t.key)}
                style={[s.tab, tab === t.key && s.tabActive]}>
                <Text style={[s.tabText, tab === t.key && s.tabTextActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Body */}
          {loading ? (
            <View style={s.center}><ActivityIndicator color={theme.color.accent} size="large" /></View>
          ) : error ? (
            <View style={s.center}>
              <Text style={s.errorText}>{error}</Text>
              <Pressable onPress={() => void load(shopId)} style={s.retryBtn}>
                <Text style={s.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : detail ? (
            <ScrollView style={s.body} showsVerticalScrollIndicator={false}>
              {tab === 'overview' && <OverviewTab detail={detail} />}
              {tab === 'products' && <ProductsTab products={detail.products} />}
              {tab === 'orders' && <OrdersTab orders={detail.recentOrders} />}
              {tab === 'kyc' && <KycTab kyc={detail.kyc} />}
            </ScrollView>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ detail }: { detail: ShopDetail }) {
  const hasDues = detail.outstandingDuesPaise > 0;

  return (
    <View style={s.tabContent}>
      {/* KPI tiles */}
      <View style={s.kpiRow}>
        <KpiTile label="Rating" value={detail.ratingCount > 0 ? `${detail.avgRating.toFixed(1)} ★` : '—'} sub={`${detail.ratingCount} reviews`} />
        <KpiTile label="Dues" value={hasDues ? formatRupeesCompact(detail.outstandingDuesPaise) : '—'} sub={hasDues ? 'outstanding' : 'all clear'} warn={hasDues} />
        <KpiTile label="Commission" value={ratePct(detail.commissionRate)} sub={detail.commissionFreeUntil && new Date(detail.commissionFreeUntil) > new Date() ? `free until ${fmtDate(detail.commissionFreeUntil)}` : 'active'} />
        <KpiTile label="Credit Limit" value={formatRupeesCompact(detail.creditLimitPaise)} sub="allowed credit" />
      </View>

      <SectionHeader title="Business Info" />
      <View style={s.card2}>
        {detail.addressLine ? <Row label="Address" value={detail.addressLine} /> : null}
        {detail.contactPhone ? <Row label="Phone" value={detail.contactPhone} /> : null}
        {detail.legalName ? <Row label="Legal Name" value={detail.legalName} /> : null}
        {detail.gstin ? <Row label="GSTIN" value={detail.gstin} mono /> : null}
        {detail.stateCode ? <Row label="State Code" value={detail.stateCode} /> : null}
        {detail.upiVpa ? <Row label="UPI VPA" value={detail.upiVpa} mono /> : null}
        <Row label="Joined" value={fmtDate(detail.createdAt)} />
        {detail.ownerLoginPin ? <Row label="Owner PIN" value={detail.ownerLoginPin} mono /> : null}
      </View>

      <SectionHeader title="Delivery Config" />
      <View style={s.card2}>
        <Row label="Platform Delivery" value={detail.platformDeliveryEnabled ? 'Enabled' : 'Disabled'} />
        <Row label="Self Pickup" value={detail.selfPickupEnabled ? 'Enabled' : 'Disabled'} />
        <Row label="Delivery Fee" value={detail.deliveryFeePaise > 0 ? formatRupees(detail.deliveryFeePaise) : 'Free'} />
        {detail.freeDeliveryAbovePaise ? <Row label="Free Delivery Above" value={formatRupees(detail.freeDeliveryAbovePaise)} /> : null}
        <Row label="Min Order" value={detail.minOrderValuePaise > 0 ? formatRupees(detail.minOrderValuePaise) : 'None'} />
      </View>

      {detail.offerText ? (
        <>
          <SectionHeader title="Active Offer" />
          <View style={s.offerBox}>
            <Text style={s.offerText}>{detail.offerText}</Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

function KpiTile({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <View style={s.kpiTile}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={[s.kpiValue, warn && { color: theme.color.warning }]}>{value}</Text>
      {sub ? <Text style={s.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

// ─── Products Tab ─────────────────────────────────────────────────────────────

function ProductsTab({ products }: { products: ShopDetail['products'] }) {
  if (products.length === 0) {
    return <View style={s.empty}><Text style={s.emptyText}>No products listed yet.</Text></View>;
  }
  return (
    <View style={s.tabContent}>
      {/* Header */}
      <View style={[s.prodRow, s.prodHead]}>
        <Text style={[s.prodCell, s.prodName, s.th]}>Product</Text>
        <Text style={[s.prodCell, s.prodPrice, s.th]}>Price</Text>
        <Text style={[s.prodCell, s.prodStock, s.th]}>Stock</Text>
        <Text style={[s.prodCell, s.prodOrders, s.th]}>Orders</Text>
        <Text style={[s.prodCell, s.prodStatus, s.th]}>Status</Text>
      </View>
      {products.map((p, i) => {
        const lowStock = p.stock > 0 && p.stock <= 5;
        const outOfStock = p.stock === 0;
        return (
          <View key={p.id} style={[s.prodRow, i % 2 === 1 && s.prodRowAlt]}>
            <Text style={[s.prodCell, s.prodName, s.prodCellText]} numberOfLines={2}>{p.name}</Text>
            <View style={[s.prodCell, s.prodPrice]}>
              <Text style={s.prodCellText}>{formatRupees(p.pricePaise)}</Text>
              {p.mrpPaise && p.mrpPaise > p.pricePaise ? (
                <Text style={s.mrpText}>{formatRupees(p.mrpPaise)}</Text>
              ) : null}
            </View>
            <Text style={[s.prodCell, s.prodStock, s.prodCellText,
              outOfStock && { color: theme.color.critical, fontWeight: '700' },
              lowStock && { color: theme.color.warning, fontWeight: '700' },
            ]}>
              {p.stock}
            </Text>
            <Text style={[s.prodCell, s.prodOrders, s.prodCellText]}>{p.orderCount}</Text>
            <View style={[s.prodCell, s.prodStatus]}>
              <View style={[s.badge, {
                backgroundColor: p.available ? '#D1FAE5' : '#FEE2E2',
              }]}>
                <Text style={[s.badgeText, { color: p.available ? theme.color.good : theme.color.critical }]}>
                  {p.available ? 'Active' : 'Off'}
                </Text>
              </View>
            </View>
          </View>
        );
      })}
      <View style={s.tableFooter}>
        <Text style={s.tableFooterText}>
          {products.filter(p => p.available).length} active · {products.filter(p => p.stock === 0).length} out of stock · {products.reduce((s, p) => s + p.orderCount, 0)} total orders
        </Text>
      </View>
    </View>
  );
}

// ─── Orders Tab ───────────────────────────────────────────────────────────────

function OrdersTab({ orders }: { orders: ShopDetail['recentOrders'] }) {
  if (orders.length === 0) {
    return <View style={s.empty}><Text style={s.emptyText}>No orders yet.</Text></View>;
  }
  return (
    <View style={s.tabContent}>
      {orders.map((o, i) => {
        const sc = STATUS_COLORS[o.status] ?? { bg: '#F1F5F9', fg: '#64748B' };
        return (
          <View key={o.orderId} style={[s.orderRow, i > 0 && s.orderRowBorder]}>
            <View style={s.orderLeft}>
              <Text style={s.orderNum}>#{o.orderNumber}</Text>
              <Text style={s.orderMeta}>{o.customer?.name ?? o.customer?.phone ?? '—'} · {o.itemCount} item{o.itemCount !== 1 ? 's' : ''}</Text>
              {o.reason ? <Text style={s.orderReason} numberOfLines={1}>↳ {o.reason}</Text> : null}
              <Text style={s.orderDate}>{fmtDate(o.createdAt)}</Text>
            </View>
            <View style={s.orderRight}>
              <Text style={s.orderTotal}>{formatRupees(o.totalPaise)}</Text>
              <View style={[s.badge, { backgroundColor: sc.bg }]}>
                <Text style={[s.badgeText, { color: sc.fg }]}>{statusLabel(o.status)}</Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── KYC Tab ──────────────────────────────────────────────────────────────────

function KycTab({ kyc }: { kyc: ShopDetail['kyc'] }) {
  if (!kyc) {
    return <View style={s.empty}><Text style={s.emptyText}>No KYC submitted yet.</Text></View>;
  }
  return (
    <View style={s.tabContent}>
      <View style={s.kycNotice}>
        <Text style={s.kycNoticeText}>Sensitive — admin access only. Audit-logged.</Text>
      </View>
      <View style={s.card2}>
        {kyc.aadhaarPan ? <Row label="Aadhaar / PAN" value={kyc.aadhaarPan} mono /> : null}
        {kyc.gstOrLicence ? <Row label="GST / Licence" value={kyc.gstOrLicence} mono /> : null}
        {kyc.fssai ? <Row label="FSSAI" value={kyc.fssai} mono /> : null}
        {kyc.createdAt ? <Row label="Submitted" value={fmtDate(kyc.createdAt)} /> : null}
      </View>
      {kyc.bankProofUrl ? (
        <>
          <SectionHeader title="Bank Proof" />
          <View style={s.card2}>
            <Text style={[s.rowValue, { fontFamily: 'monospace', fontSize: theme.font.tiny }]} numberOfLines={2} selectable>{kyc.bankProofUrl}</Text>
          </View>
        </>
      ) : null}
      {kyc.docUrls && kyc.docUrls.length > 0 ? (
        <>
          <SectionHeader title={`Documents (${kyc.docUrls.length})`} />
          <View style={s.card2}>
            {(kyc.docUrls as string[]).map((url, i) => (
              <Text key={i} style={[s.rowValue, { fontFamily: 'monospace', fontSize: theme.font.tiny, marginBottom: 4 }]} numberOfLines={2} selectable>{url}</Text>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 700, maxHeight: '90%', backgroundColor: theme.color.surface, borderRadius: 16, overflow: 'hidden', ...theme.shadow.card },

  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  modalTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  modalSub: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  closeBtn: { padding: 4 },
  closeBtnText: { fontSize: 18, color: theme.color.textMuted, fontWeight: '700' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusBadgeText: { fontSize: theme.font.tiny, fontWeight: '700' },
  dot: { width: 7, height: 7, borderRadius: 4 },

  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surfaceAlt, paddingHorizontal: 16 },
  tab: { paddingVertical: 10, paddingHorizontal: 14, marginRight: 2 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: theme.color.accent },
  tabText: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  tabTextActive: { color: theme.color.accent },

  body: { flex: 1 },
  tabContent: { padding: 20, gap: 14 },
  center: { padding: 40, alignItems: 'center', gap: 12 },
  errorText: { color: theme.color.critical, fontSize: theme.font.body },
  retryBtn: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 8, backgroundColor: theme.color.primary },
  retryText: { color: '#fff', fontWeight: '700' },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionBar: { width: 3, height: 16, borderRadius: 2, backgroundColor: theme.color.accent },
  sectionTitle: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.text, textTransform: 'uppercase', letterSpacing: 0.5 },

  card2: { backgroundColor: theme.color.surfaceAlt, borderRadius: 10, borderWidth: 1, borderColor: theme.color.border, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  rowLabel: { fontSize: theme.font.small, color: theme.color.textMuted, flex: 1 },
  rowValue: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.text, flex: 2, textAlign: 'right' },

  kpiRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  kpiTile: { flex: 1, minWidth: 120, backgroundColor: theme.color.surfaceAlt, borderRadius: 10, borderWidth: 1, borderColor: theme.color.border, padding: 12, gap: 2 },
  kpiLabel: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  kpiValue: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  kpiSub: { fontSize: theme.font.tiny, color: theme.color.textFaint },

  offerBox: { backgroundColor: '#FEF9C3', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#FDE047' },
  offerText: { fontSize: theme.font.body, color: '#713F12', fontWeight: '600' },

  // Products table
  prodRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  prodHead: { backgroundColor: theme.color.surfaceAlt },
  prodRowAlt: { backgroundColor: '#FAFBFC' },
  prodCell: { paddingHorizontal: 4 },
  prodName: { flex: 3 },
  prodPrice: { flex: 2, gap: 1 },
  prodStock: { flex: 1, textAlign: 'center' },
  prodOrders: { flex: 1, textAlign: 'center' },
  prodStatus: { flex: 1.5, alignItems: 'flex-end' },
  prodCellText: { fontSize: theme.font.small, color: theme.color.text },
  mrpText: { fontSize: theme.font.tiny, color: theme.color.textFaint, textDecorationLine: 'line-through' },
  th: { fontSize: theme.font.tiny, fontWeight: '800', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 },
  tableFooter: { paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center' },
  tableFooterText: { fontSize: theme.font.tiny, color: theme.color.textFaint },

  // Orders list
  orderRow: { paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  orderRowBorder: { borderTopWidth: 1, borderTopColor: theme.color.border },
  orderLeft: { flex: 1, gap: 2 },
  orderRight: { alignItems: 'flex-end', gap: 6 },
  orderNum: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text, fontFamily: 'monospace' },
  orderMeta: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  orderReason: { fontSize: theme.font.tiny, color: theme.color.critical, fontStyle: 'italic' },
  orderDate: { fontSize: theme.font.tiny, color: theme.color.textFaint, marginTop: 2 },
  orderTotal: { fontSize: theme.font.body, fontWeight: '800', color: theme.color.text },

  // KYC
  kycNotice: { backgroundColor: theme.color.warningBg, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#FDE047' },
  kycNoticeText: { fontSize: theme.font.tiny, fontWeight: '700', color: '#713F12' },

  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  badgeText: { fontSize: theme.font.tiny, fontWeight: '700' },

  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: theme.color.textFaint, fontSize: theme.font.body },
});
