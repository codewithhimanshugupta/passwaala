import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '../api';
import type { BulkOrderDetail, BulkSubOrder } from '../types';
import { formatRupees, shadow, theme } from '../theme';
import { Divider, ErrorState } from '../ui';

const BULK_PURPLE = '#7C3AED';
const BULK_PURPLE_LIGHT = '#EDE9FE';

export function BulkOrderDetailScreen({
  bulkOrderId,
  onBack,
}: {
  bulkOrderId: string;
  onBack: () => void;
}) {
  const [order, setOrder] = useState<BulkOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = (await api.bulkOrder(bulkOrderId)) as BulkOrderDetail;
      setOrder(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [bulkOrderId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <View style={styles.root}>
        <Header onBack={onBack} title="Bulk Order" />
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={BULK_PURPLE} />
        </View>
      </View>
    );
  }

  if (error || !order) {
    return <ErrorState message={error ?? 'Order not found'} onRetry={load} />;
  }

  const placedOn = new Date(order.createdAt).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });

  const statusMeta = bulkStatusMeta(order.status);
  const isOutForDelivery = order.status === 'OUT_FOR_DELIVERY';
  const isUpi = order.paymentMethod === 'UPI_DIRECT';
  const isCod = order.paymentMethod === 'COD';

  // Per-shop subtotals (items only, before platform fee and discount)
  const shopSubtotals = order.orders.map((sub) => ({
    shopId: sub.shopId,
    shopName: sub.shop.name,
    itemsSubtotalPaise: sub.originalTotalPaise,
  }));

  const itemsGrandTotal = shopSubtotals.reduce((s, x) => s + x.itemsSubtotalPaise, 0);

  return (
    <View style={styles.root}>
      <Header onBack={onBack} title="Bulk Order" subtitle={order.shortId} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Envelope status card */}
        <View style={styles.section}>
          <View style={styles.envelopeRow}>
            <View style={styles.envelopeLeft}>
              <Text style={styles.envelopeShortId}>{order.shortId}</Text>
              <Text style={styles.envelopeMeta}>
                {order.orders.length} shop{order.orders.length !== 1 ? 's' : ''}{'  •  '}{placedOn}
              </Text>
            </View>
            <Text style={[styles.statusBadge, { backgroundColor: statusMeta.bg, color: statusMeta.fg }]}>
              {statusMeta.label}
            </Text>
          </View>

          {/* OTP block — shown prominently when rider is en route */}
          {isOutForDelivery && order.pickupOtp ? (
            <View style={styles.otpBox}>
              <Text style={styles.otpLabel}>Delivery OTP</Text>
              <Text style={styles.otpCode}>{order.pickupOtp}</Text>
              <Text style={styles.otpHint}>
                Show this code to the rider when your delivery arrives
              </Text>
            </View>
          ) : null}
        </View>

        {/* Payment notice */}
        {isUpi ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Payment</Text>
            <View style={styles.payNotice}>
              <Text style={styles.payNoticeTitle}>Pay each shop via UPI</Text>
              <Text style={styles.payNoticeBody}>
                Transfer directly to each shop's UPI when you receive the goods.
              </Text>
              <View style={styles.payNoticeOrderRow}>
                <Text style={styles.payNoticeOrderLabel}>Order reference</Text>
                <Text style={styles.payNoticeOrderValue}>{order.shortId}</Text>
              </View>
              <Text style={styles.payNoticeHint}>
                Show this order number to each shop if asked
              </Text>
            </View>
          </View>
        ) : isCod ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Payment</Text>
            <View style={[styles.payNotice, styles.payNoticeCod]}>
              <Text style={styles.payNoticeTitle}>Cash on delivery</Text>
              <Text style={styles.payNoticeBody}>
                Pay {formatRupees(order.totalPaise)} in cash when the rider delivers your order.
              </Text>
            </View>
          </View>
        ) : null}

        {/* Sub-orders (per shop) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {order.orders.length} Shop{order.orders.length !== 1 ? 's' : ''}
          </Text>
          {order.orders.map((sub, idx) => (
            <SubOrderCard key={sub.id} sub={sub} isLast={idx === order.orders.length - 1} />
          ))}
        </View>

        {/* Bill breakdown */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bill breakdown</Text>

          {shopSubtotals.map((s) => (
            <BillRow key={s.shopId} label={`Items — ${s.shopName}`} value={formatRupees(s.itemsSubtotalPaise)} />
          ))}

          <Divider style={styles.divider} />

          <BillRow label="Items total" value={formatRupees(itemsGrandTotal)} />
          <BillRow label="Base delivery" value={formatRupees(order.baseDeliveryFeePaise)} />
          {order.multiShopSurchargePaise > 0 ? (
            <BillRow
              label={`Multi-shop surcharge (${order.orders.length - 1} extra stop${order.orders.length > 2 ? 's' : ''})`}
              value={`+${formatRupees(order.multiShopSurchargePaise)}`}
            />
          ) : null}
          <BillRow label={`Platform fee (×${order.orders.length})`} value={formatRupees(order.platformFeePaise)} />

          <Divider style={styles.divider} />
          <BillRow label="Grand total" value={formatRupees(order.totalPaise)} bold />
        </View>

        {/* Delivery address */}
        {order.address?.line ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Delivery address</Text>
            <View style={styles.addrCard}>
              <Text style={styles.addrLine}>{order.address.line}</Text>
              {order.address.landmark ? (
                <Text style={styles.addrLandmark}>Near {order.address.landmark}</Text>
              ) : null}
            </View>
          </View>
        ) : null}

      </ScrollView>
    </View>
  );
}

/** A card for one sub-order (one shop's portion of the bulk order). */
function SubOrderCard({ sub, isLast }: { sub: BulkSubOrder; isLast: boolean }) {
  const statusMeta = bulkStatusMeta(sub.status);
  return (
    <View style={[styles.subCard, isLast && styles.subCardLast]}>
      <View style={styles.subCardHeader}>
        <View style={styles.flex}>
          <Text style={styles.subShopName}>{sub.shop.name}</Text>
          {sub.shop.addressLine ? (
            <Text style={styles.subShopAddr} numberOfLines={1}>{sub.shop.addressLine}</Text>
          ) : null}
        </View>
        <Text style={[styles.subStatusBadge, { backgroundColor: statusMeta.bg, color: statusMeta.fg }]}>
          {statusMeta.label}
        </Text>
      </View>

      {/* Items */}
      <View style={styles.subItems}>
        {sub.items.map((item, i) => (
          <View key={i} style={styles.subItemRow}>
            <View style={styles.subItemDot} />
            <Text style={styles.subItemName} numberOfLines={2}>{item.nameSnapshot}</Text>
            <Text style={styles.subItemQty}>×{item.qty}</Text>
            <Text style={styles.subItemPrice}>{formatRupees(item.pricePaiseSnapshot * item.qty)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.subTotalRow}>
        <Text style={styles.subTotalLabel}>Sub-total</Text>
        <Text style={styles.subTotalValue}>{formatRupees(sub.originalTotalPaise)}</Text>
      </View>
    </View>
  );
}

function Header({
  onBack,
  title,
  subtitle,
}: {
  onBack: () => void;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerBack}>
        <Text style={styles.headerBackText}>←</Text>
      </Pressable>
      <View style={styles.flex}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSub}>{subtitle}</Text> : null}
      </View>
      {/* Purple BULK badge */}
      <View style={styles.bulkBadge}>
        <Text style={styles.bulkBadgeText}>BULK</Text>
      </View>
    </View>
  );
}

function BillRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <View style={styles.billRow}>
      <Text style={[styles.billLabel, bold && styles.billBold]}>{label}</Text>
      <Text style={[styles.billValue, bold && styles.billBold]}>{value}</Text>
    </View>
  );
}

/** Map a bulk/sub-order status string to display label + colours. */
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
    case 'REFUND_PENDING':
      return { label: 'Refund pending', bg: theme.color.warningLight, fg: theme.color.warning };
    case 'REFUNDED':
      return { label: 'Refunded', bg: theme.color.successLight, fg: theme.color.success };
    default:
      return { label: status, bg: theme.color.surfaceAlt, fg: theme.color.textMuted };
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  flex: { flex: 1 },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 40, gap: theme.space.md, paddingTop: theme.space.md },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    backgroundColor: theme.color.bg,
    ...shadow.sm,
  },
  headerBack: {
    width: 36, height: 36,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  headerBackText: { fontSize: 20, fontWeight: '700', color: theme.color.text },
  headerTitle: { fontSize: theme.font.h2, fontWeight: '800', color: theme.color.text },
  headerSub: { fontSize: theme.font.small, color: theme.color.textMuted, fontFamily: 'monospace' },
  bulkBadge: {
    backgroundColor: BULK_PURPLE_LIGHT,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  bulkBadgeText: {
    fontSize: theme.font.tiny,
    fontWeight: '800',
    color: BULK_PURPLE,
    letterSpacing: 1,
  },

  // Generic section card
  section: {
    backgroundColor: theme.color.card,
    marginHorizontal: theme.space.lg,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    gap: theme.space.sm,
    ...shadow.sm,
  },
  sectionTitle: {
    fontSize: theme.font.h3,
    fontWeight: '700',
    color: theme.color.text,
    marginBottom: 4,
  },

  // Envelope (top) status row
  envelopeRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  envelopeLeft: { flex: 1, gap: 4 },
  envelopeShortId: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text, fontFamily: 'monospace' },
  envelopeMeta: { fontSize: theme.font.small, color: theme.color.textMuted },
  statusBadge: {
    fontSize: theme.font.small,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },

  // OTP box
  otpBox: {
    marginTop: theme.space.sm,
    backgroundColor: '#EDE9FE',
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderColor: BULK_PURPLE,
  },
  otpLabel: { fontSize: theme.font.small, fontWeight: '700', color: BULK_PURPLE, textTransform: 'uppercase', letterSpacing: 1 },
  otpCode: { fontSize: 40, fontWeight: '900', color: BULK_PURPLE, letterSpacing: 8, fontFamily: 'monospace' },
  otpHint: { fontSize: theme.font.small, color: BULK_PURPLE, textAlign: 'center', opacity: 0.8 },

  // Payment notice
  payNotice: {
    backgroundColor: theme.color.primaryLight,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    gap: 4,
    borderWidth: 1,
    borderColor: theme.color.primary,
  },
  payNoticeCod: {
    backgroundColor: theme.color.accentLight,
    borderColor: theme.color.accent,
  },
  payNoticeTitle: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  payNoticeBody: { fontSize: theme.font.small, color: theme.color.textMuted, lineHeight: 18 },
  payNoticeOrderRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, marginTop: theme.space.xs },
  payNoticeOrderLabel: { fontSize: theme.font.small, color: theme.color.textMuted },
  payNoticeOrderValue: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.text, fontFamily: 'monospace' },
  payNoticeHint: { fontSize: theme.font.tiny, color: theme.color.textFaint, marginTop: 2 },

  // Sub-order card
  subCard: {
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingTop: theme.space.md,
    marginTop: theme.space.sm,
    gap: theme.space.sm,
  },
  subCardLast: {},
  subCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm },
  subShopName: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  subShopAddr: { fontSize: theme.font.tiny, color: theme.color.textMuted, marginTop: 2 },
  subStatusBadge: {
    fontSize: theme.font.tiny,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  subItems: { gap: 4 },
  subItemRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
  subItemDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.color.border, marginRight: 4 },
  subItemName: { flex: 1, fontSize: theme.font.small, color: theme.color.text },
  subItemQty: { fontSize: theme.font.small, color: theme.color.textMuted, minWidth: 28 },
  subItemPrice: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.text },
  subTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: theme.color.border,
    paddingTop: theme.space.xs, marginTop: 2,
  },
  subTotalLabel: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  subTotalValue: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },

  // Bill breakdown
  billRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  billLabel: { fontSize: theme.font.body, color: theme.color.textMuted, flex: 1, marginRight: 8 },
  billValue: { fontSize: theme.font.body, color: theme.color.text },
  billBold: { fontWeight: '800', color: theme.color.text, fontSize: theme.font.h3 },
  divider: { marginVertical: theme.space.xs },

  // Delivery address
  addrCard: {
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
    gap: 2,
  },
  addrLine: { fontSize: theme.font.body, color: theme.color.text, fontWeight: '500' },
  addrLandmark: { fontSize: theme.font.small, color: theme.color.textMuted },
});
