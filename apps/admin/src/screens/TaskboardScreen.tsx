import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '@passwaala/api-client';
import { api } from '../api';
import { theme } from '../theme';

type Taskboard = Awaited<ReturnType<typeof api.adminTaskboard>>;
type TaskItem = Taskboard['items'][number];
type AutoLog = Taskboard['automationLog'][number];

const ACTION_LABELS: Record<string, string> = {
  ORDER_AUTO_CANCELLED: 'Order auto-cancelled',
  ORDER_REMIND: 'Shop re-notified',
  RIDER_EARNINGS_CREDITED: 'Rider earnings credited',
  SHOP_AUTO_PAUSED: 'Shop auto-paused',
  SHOP_AUTO_OPENED: 'Shop auto-opened',
  SHOP_AUTO_CLOSED: 'Shop auto-closed',
  DISPATCH_RE_OFFERED: 'Dispatch re-offered',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatRs(paise: number): string {
  return `₹${(paise / 100).toFixed(0)}`;
}

export function TaskboardScreen() {
  const [data, setData] = useState<Taskboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [revertTarget, setRevertTarget] = useState<AutoLog | null>(null);
  const [revertNote, setRevertNote] = useState('');
  const [revertBusy, setRevertBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [detailLog, setDetailLog] = useState<AutoLog | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.adminTaskboard());
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setError('Admin access required.');
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function flash(msg: string) {
    setBanner(msg);
    setTimeout(() => setBanner(null), 3500);
  }

  async function doRevert() {
    if (!revertTarget) return;
    setRevertBusy(true);
    try {
      await api.adminRevertAutomation(revertTarget.id, revertNote.trim() || undefined);
      setRevertTarget(null);
      setRevertNote('');
      flash(`Reverted: ${ACTION_LABELS[revertTarget.action] ?? revertTarget.action}`);
      await load();
    } catch (e) {
      flash(`Revert failed: ${(e as Error).message}`);
    } finally {
      setRevertBusy(false);
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={theme.color.accent} size="large" /></View>;
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryBtn} onPress={load}><Text style={styles.retryBtnText}>Retry</Text></Pressable>
      </View>
    );
  }
  if (!data) return null;

  const { summary, items, automationLog } = data;
  const q = search.trim().toLowerCase();

  const filteredItems = q
    ? items.filter(item => {
        if (item.type === 'KYC') return item.shopName.toLowerCase().includes(q) || (item.city ?? '').toLowerCase().includes(q);
        if (item.type === 'PAYMENT_CLAIM') return item.entityName.toLowerCase().includes(q);
        if (item.type === 'REFUND') return item.shopName.toLowerCase().includes(q) || item.orderRef.toLowerCase().includes(q);
        if (item.type === 'SHOP_PAUSED') return item.shopName.toLowerCase().includes(q);
        return false;
      })
    : items;

  const filteredLog = q
    ? automationLog.filter(l =>
        l.action.toLowerCase().includes(q) ||
        l.detail.toLowerCase().includes(q) ||
        (l.orderId ?? '').toLowerCase().includes(q) ||
        (ACTION_LABELS[l.action] ?? '').toLowerCase().includes(q)
      )
    : automationLog;

  const unrevertedLog = filteredLog.filter(l => !l.revertedAt);
  const revertedLog = filteredLog.filter(l => l.revertedAt);

  return (
    <View style={styles.wrap}>
      {banner ? (
        <View style={styles.banner}><Text style={styles.bannerText}>{banner}</Text></View>
      ) : null}

      <ScrollView contentContainerStyle={styles.body}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.h1}>Taskboard</Text>
            <Text style={styles.sub}>Pending human tasks + system automation log</Text>
          </View>
          <Pressable style={styles.refreshBtn} onPress={load}>
            <Text style={styles.refreshText}>Refresh</Text>
          </Pressable>
        </View>

        {/* Search */}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search tasks, shops, orders, actions…"
            placeholderTextColor={theme.color.textFaint}
            value={search}
            onChangeText={setSearch}
            clearButtonMode="while-editing"
          />
          {search ? (
            <Pressable style={styles.clearBtn} onPress={() => setSearch('')}>
              <Text style={styles.clearBtnText}>✕</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Summary tiles */}
        <View style={styles.tilesRow}>
          <SummaryTile label="KYC Pending" count={summary.pendingKyc} tone="warning" />
          <SummaryTile label="Payment Claims" count={summary.pendingClaims} tone="info" />
          <SummaryTile label="Refunds" count={summary.refundPending} tone="critical" />
          <SummaryTile label="Paused Shops" count={summary.pausedShops} tone="critical" />
        </View>

        {/* Pending manual tasks */}
        <Text style={styles.sectionTitle}>Needs human attention{q ? ` — "${search}"` : ''}</Text>
        {filteredItems.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{q ? 'No matches' : 'All clear'}</Text>
            <Text style={styles.emptyBody}>{q ? 'Try a different search.' : 'No pending tasks right now.'}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {filteredItems.map((item, i) => <TaskCard key={i} item={item} />)}
          </View>
        )}

        {/* Automation log — active */}
        <Text style={styles.sectionTitle}>Done by system{q ? ` — "${search}"` : ''}</Text>
        {unrevertedLog.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyBody}>{q ? 'No matches.' : 'No recent automation activity.'}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {unrevertedLog.map(log => (
              <AutoLogCard
                key={log.id}
                log={log}
                onRevert={() => { setRevertTarget(log); setRevertNote(''); }}
                onViewDetail={() => setDetailLog(log)}
              />
            ))}
          </View>
        )}

        {/* Automation log — reverted */}
        {revertedLog.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: theme.color.textFaint }]}>Reverted by admin</Text>
            <View style={styles.list}>
              {revertedLog.map(log => (
                <AutoLogCard key={log.id} log={log} reverted onViewDetail={() => setDetailLog(log)} />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* Detail panel — slide in from right */}
      <Modal visible={!!detailLog} transparent animationType="slide" onRequestClose={() => setDetailLog(null)}>
        <View style={styles.panelBackdrop}>
          <Pressable style={styles.panelDismiss} onPress={() => setDetailLog(null)} />
          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>
                {detailLog ? (ACTION_LABELS[detailLog.action] ?? detailLog.action) : ''}
              </Text>
              <Pressable onPress={() => setDetailLog(null)} hitSlop={8}>
                <Text style={styles.panelClose}>✕</Text>
              </Pressable>
            </View>
            {detailLog && <DetailPanelContent log={detailLog} />}
          </View>
        </View>
      </Modal>

      {/* Revert confirmation modal */}
      <Modal visible={!!revertTarget} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Revert automation action?</Text>
            {revertTarget && (
              <Text style={styles.modalBody}>
                {ACTION_LABELS[revertTarget.action] ?? revertTarget.action}: {revertTarget.detail}
              </Text>
            )}
            <Text style={styles.label}>Note (optional)</Text>
            <TextInput
              style={styles.noteInput}
              placeholder="Why are you reverting this?"
              placeholderTextColor={theme.color.textFaint}
              value={revertNote}
              onChangeText={setRevertNote}
              multiline
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.ghostBtn} onPress={() => setRevertTarget(null)} disabled={revertBusy}>
                <Text style={styles.ghostBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.revertConfirmBtn, revertBusy && styles.busyBtn]} onPress={doRevert} disabled={revertBusy}>
                {revertBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.revertConfirmText}>Yes, revert</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Detail panel content — loads order data when the log has an orderId
// ---------------------------------------------------------------------------

function DetailPanelContent({ log }: { log: AutoLog }) {
  const [order, setOrder] = useState<Record<string, unknown> | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(false);

  useEffect(() => {
    if (!log.orderId) return;
    setLoadingOrder(true);
    api.adminListOrders({ limit: 200 })
      .then((res) => {
        const items = (res as { items: Record<string, unknown>[] }).items ?? [];
        setOrder(items.find((o) => o.orderId === log.orderId) ?? null);
      })
      .catch(() => setOrder(null))
      .finally(() => setLoadingOrder(false));
  }, [log.orderId]);

  const shop = order?.shop as { name?: string; city?: string } | null;
  const customer = order?.customer as { name?: string | null; phone?: string | null } | null;
  const rider = order?.rider as { name?: string | null; phone?: string | null } | null;
  const orderItems = (order?.items as Array<{ nameSnapshot: string; qty: number; pricePaiseSnapshot: number }>) ?? [];

  return (
    <ScrollView contentContainerStyle={styles.panelBody}>
      {/* Log metadata */}
      <View style={styles.detailSection}>
        <Text style={styles.detailSectionTitle}>Automation details</Text>
        <DetailRow label="Action" value={ACTION_LABELS[log.action] ?? log.action} />
        <DetailRow label="Description" value={log.detail} />
        <DetailRow label="Triggered at" value={formatDate(log.createdAt)} />
        {log.orderId && <DetailRow label="Order" value={`#${log.orderId.slice(0, 8).toUpperCase()}`} />}
        {log.shopId && <DetailRow label="Shop" value={`#${log.shopId.slice(0, 8).toUpperCase()}`} />}
        {log.riderUserId && <DetailRow label="Rider" value={`#${log.riderUserId.slice(0, 8).toUpperCase()}`} />}
        {log.revertedAt && <DetailRow label="Reverted at" value={formatDate(log.revertedAt)} />}
        {log.revertNote && <DetailRow label="Revert note" value={log.revertNote} />}
      </View>

      {/* Order details */}
      {log.orderId && (
        <View style={styles.detailSection}>
          <Text style={styles.detailSectionTitle}>Order</Text>
          {loadingOrder ? (
            <ActivityIndicator color={theme.color.accent} />
          ) : order ? (
            <>
              <DetailRow label="Ref" value={`#${log.orderId.slice(0, 8).toUpperCase()}`} mono />
              {shop && <DetailRow label="Shop" value={`${shop.name ?? '?'} · ${shop.city ?? '?'}`} />}
              {customer && <DetailRow label="Customer" value={`${customer.name ?? '—'} · ${customer.phone ?? ''}`} />}
              {rider && <DetailRow label="Rider" value={`${rider.name ?? '—'} · ${rider.phone ?? ''}`} />}
              <DetailRow label="Amount" value={formatRs(order.totalPaise as number ?? 0)} />
              <DetailRow label="Payment" value={String(order.paymentMethod ?? '')} />
              <DetailRow label="Delivery" value={String(order.deliveryMode ?? '')} />
              <DetailRow label="Status" value={String(order.status ?? '')} />
              {order.reason ? <DetailRow label="Reason" value={String(order.reason)} /> : null}
              {orderItems.length > 0 && (
                <View style={styles.itemsList}>
                  <Text style={styles.detailLabel}>Items</Text>
                  {orderItems.map((it, i) => (
                    <Text key={i} style={styles.detailValue}>
                      {it.qty}× {it.nameSnapshot} — ₹{(it.pricePaiseSnapshot / 100).toFixed(2)}
                    </Text>
                  ))}
                </View>
              )}
            </>
          ) : (
            <Text style={styles.detailValue}>Order details not available</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.detailMono]}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryTile({ label, count, tone }: { label: string; count: number; tone: 'warning' | 'info' | 'critical' | 'good' }) {
  const bg = tone === 'warning' ? theme.color.warningBg : tone === 'critical' ? theme.color.criticalBg : tone === 'good' ? theme.color.goodBg : theme.color.infoBg;
  const fg = tone === 'warning' ? theme.color.warning : tone === 'critical' ? theme.color.critical : tone === 'good' ? theme.color.good : theme.color.info;
  return (
    <View style={[styles.tile, { backgroundColor: bg, borderColor: fg + '40' }]}>
      <Text style={[styles.tileCount, { color: fg }]}>{count}</Text>
      <Text style={[styles.tileLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}

function TaskCard({ item }: { item: TaskItem }) {
  const [expanded, setExpanded] = useState(false);

  const typeColor: Record<string, string> = { KYC: theme.color.warning, PAYMENT_CLAIM: theme.color.info, REFUND: theme.color.critical, SHOP_PAUSED: theme.color.critical };
  const typeBg: Record<string, string> = { KYC: theme.color.warningBg, PAYMENT_CLAIM: theme.color.infoBg, REFUND: theme.color.criticalBg, SHOP_PAUSED: theme.color.criticalBg };
  const typeLabel: Record<string, string> = { KYC: 'KYC Review', PAYMENT_CLAIM: 'Payment Claim', REFUND: 'Refund Pending', SHOP_PAUSED: 'Shop Paused' };

  const color = typeColor[item.type] ?? theme.color.textMuted;
  const bg = typeBg[item.type] ?? theme.color.surfaceAlt;

  let title = '';
  let summary = '';
  if (item.type === 'KYC') { title = item.shopName; summary = `${item.city ?? 'unknown city'} · waiting ${timeAgo(item.since)}`; }
  else if (item.type === 'PAYMENT_CLAIM') { title = item.entityName; summary = `${item.entityType} · ${formatRs(item.amountPaise)} · ${timeAgo(item.since)}`; }
  else if (item.type === 'REFUND') { title = `#${item.orderRef} — ${item.shopName}`; summary = `${formatRs(item.amountPaise)} · ${timeAgo(item.since)}`; }
  else if (item.type === 'SHOP_PAUSED') { title = item.shopName; summary = `Dues ${formatRs(item.duesPaise)} / limit ${formatRs(item.limitPaise)} · paused ${timeAgo(item.since)}`; }

  return (
    <Pressable style={[styles.card, { borderLeftColor: color, borderLeftWidth: 3 }]} onPress={() => setExpanded(e => !e)}>
      <View style={styles.logHeader}>
        <View style={[styles.typePill, { backgroundColor: bg }]}>
          <Text style={[styles.typePillText, { color }]}>{typeLabel[item.type] ?? item.type}</Text>
        </View>
        <Text style={styles.expandChevron}>{expanded ? '▲' : '▼'}</Text>
      </View>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardMeta}>{summary}</Text>

      {expanded && (
        <View style={styles.expandBox}>
          <Text style={styles.expandDetail}>Since: {formatDate(item.since)}</Text>
          {item.type === 'KYC' && (
            <>
              <Text style={styles.expandDetail}>City: {item.city ?? '—'}</Text>
              <Text style={styles.expandDetail}>Shop: #{item.shopId.slice(0, 8).toUpperCase()}</Text>
              <Text style={[styles.expandHint]}>Go to Shop Approvals → review KYC docs → approve or reject</Text>
            </>
          )}
          {item.type === 'PAYMENT_CLAIM' && (
            <>
              <Text style={styles.expandDetail}>Entity: {item.entityType}</Text>
              <Text style={styles.expandDetail}>Amount: {formatRs(item.amountPaise)}</Text>
              <Text style={styles.expandDetail}>Claim: #{item.claimId.slice(0, 8).toUpperCase()}</Text>
              <Text style={styles.expandHint}>Verify payment received → go to Payments → approve</Text>
            </>
          )}
          {item.type === 'REFUND' && (
            <>
              <Text style={styles.expandDetail}>Order: #{item.orderRef.slice(0, 8).toUpperCase()}</Text>
              <Text style={styles.expandDetail}>Shop: {item.shopName}</Text>
              <Text style={styles.expandDetail}>Amount: {formatRs(item.amountPaise)}</Text>
              <Text style={styles.expandHint}>Go to Disputes → resolve the refund with the shop</Text>
            </>
          )}
          {item.type === 'SHOP_PAUSED' && (
            <>
              <Text style={styles.expandDetail}>Outstanding dues: {formatRs(item.duesPaise)}</Text>
              <Text style={styles.expandDetail}>Credit limit: {formatRs(item.limitPaise)}</Text>
              <Text style={styles.expandDetail}>Over by: {formatRs(item.duesPaise - item.limitPaise)}</Text>
              <Text style={styles.expandHint}>Go to Settlements → approve the shop's payment claim to reactivate</Text>
            </>
          )}
        </View>
      )}
    </Pressable>
  );
}

function AutoLogCard({
  log,
  onRevert,
  onViewDetail,
  reverted,
}: {
  log: AutoLog;
  onRevert?: () => void;
  onViewDetail: () => void;
  reverted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const actionLabel = ACTION_LABELS[log.action] ?? log.action;
  const isRevertable = !reverted && ['ORDER_AUTO_CANCELLED', 'SHOP_AUTO_PAUSED', 'SHOP_AUTO_CLOSED', 'SHOP_AUTO_OPENED'].includes(log.action);

  return (
    <Pressable style={[styles.card, reverted && styles.cardReverted]} onPress={() => setExpanded(e => !e)}>
      <View style={styles.logHeader}>
        <View style={[styles.typePill, { backgroundColor: reverted ? theme.color.surfaceAlt : theme.color.infoBg }]}>
          <Text style={[styles.typePillText, { color: reverted ? theme.color.textFaint : theme.color.info }]}>
            {reverted ? 'Reverted' : 'Auto'}
          </Text>
        </View>
        <Text style={styles.logTime}>{timeAgo(log.createdAt)}</Text>
        <Text style={styles.expandChevron}>{expanded ? '▲' : '▼'}</Text>
      </View>
      <Text style={styles.cardTitle}>{actionLabel}</Text>
      <Text style={styles.cardMeta}>{log.detail}</Text>
      {log.orderId && <Text style={styles.cardRef}>Order #{log.orderId.slice(0, 8).toUpperCase()}</Text>}
      {log.shopId && !log.orderId && <Text style={styles.cardRef}>Shop #{log.shopId.slice(0, 8).toUpperCase()}</Text>}

      {expanded && (
        <View style={styles.expandBox}>
          <Text style={styles.expandDetail}>Triggered: {formatDate(log.createdAt)}</Text>
          {log.orderId && <Text style={styles.expandDetail}>Order: #{log.orderId.slice(0, 8).toUpperCase()}</Text>}
          {log.shopId && <Text style={styles.expandDetail}>Shop: #{log.shopId.slice(0, 8).toUpperCase()}</Text>}
          {log.riderUserId && <Text style={styles.expandDetail}>Rider: #{log.riderUserId.slice(0, 8).toUpperCase()}</Text>}
          {reverted && log.revertedAt && <Text style={styles.expandDetail}>Reverted: {formatDate(log.revertedAt)}</Text>}
          {log.revertNote && <Text style={styles.expandDetail}>Note: {log.revertNote}</Text>}
          <Pressable style={styles.viewDetailBtn} onPress={(e) => { e.stopPropagation?.(); onViewDetail(); }}>
            <Text style={styles.viewDetailBtnText}>View full details →</Text>
          </Pressable>
        </View>
      )}

      {isRevertable && (
        <Pressable style={styles.revertBtn} onPress={(e) => { e.stopPropagation?.(); onRevert?.(); }}>
          <Text style={styles.revertBtnText}>Revert</Text>
        </Pressable>
      )}
      {reverted && log.revertNote && (
        <Text style={styles.revertNote}>Revert note: {log.revertNote}</Text>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { padding: theme.space.xl, gap: theme.space.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl, gap: theme.space.md },
  errorText: { color: theme.color.critical, fontSize: theme.font.body, textAlign: 'center' },
  retryBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.xl, borderRadius: theme.radius.md, backgroundColor: theme.color.accent },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.small },
  banner: { backgroundColor: theme.color.accent, paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl },
  bannerText: { color: '#fff', fontWeight: '600', fontSize: theme.font.small },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  h1: { fontSize: theme.font.h1, fontWeight: '800', color: theme.color.text },
  sub: { fontSize: theme.font.body, color: theme.color.textMuted, marginTop: 2 },
  refreshBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.borderStrong, backgroundColor: theme.color.surface },
  refreshText: { color: theme.color.text, fontWeight: '600', fontSize: theme.font.small },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  searchInput: { flex: 1, borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md, paddingVertical: theme.space.sm, paddingHorizontal: theme.space.md, fontSize: theme.font.body, color: theme.color.text, backgroundColor: theme.color.surface },
  clearBtn: { padding: theme.space.sm },
  clearBtnText: { color: theme.color.textMuted, fontWeight: '700', fontSize: theme.font.small },

  tilesRow: { flexDirection: 'row', gap: theme.space.md, flexWrap: 'wrap' },
  tile: { flex: 1, minWidth: 120, borderRadius: theme.radius.md, borderWidth: 1, padding: theme.space.lg, alignItems: 'center', gap: theme.space.xs },
  tileCount: { fontSize: 28, fontWeight: '800' },
  tileLabel: { fontSize: theme.font.small, fontWeight: '700', textAlign: 'center' },

  sectionTitle: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text, marginTop: theme.space.sm },
  list: { gap: theme.space.md },

  card: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, padding: theme.space.lg, gap: theme.space.sm, ...theme.shadow.card },
  cardReverted: { opacity: 0.6 },
  cardTitle: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  cardMeta: { fontSize: theme.font.small, color: theme.color.textMuted },
  cardRef: { fontSize: theme.font.small, color: theme.color.textFaint },

  typePill: { alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: theme.space.sm, borderRadius: theme.radius.pill },
  typePillText: { fontSize: theme.font.tiny, fontWeight: '700' },
  logHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  logTime: { fontSize: theme.font.tiny, color: theme.color.textFaint, marginLeft: 'auto' },
  expandChevron: { fontSize: theme.font.tiny, color: theme.color.textFaint, marginLeft: theme.space.sm },

  expandBox: { marginTop: theme.space.xs, padding: theme.space.md, backgroundColor: theme.color.surfaceAlt, borderRadius: theme.radius.md, gap: theme.space.xs },
  expandDetail: { fontSize: theme.font.small, color: theme.color.textMuted },
  expandHint: { fontSize: theme.font.small, color: theme.color.accent, fontWeight: '600', marginTop: theme.space.xs },

  viewDetailBtn: { alignSelf: 'flex-start', marginTop: theme.space.sm, paddingVertical: theme.space.xs, paddingHorizontal: theme.space.md, borderRadius: theme.radius.md, backgroundColor: theme.color.infoBg },
  viewDetailBtnText: { color: theme.color.info, fontWeight: '700', fontSize: theme.font.small },

  revertBtn: { alignSelf: 'flex-start', marginTop: theme.space.xs, paddingVertical: theme.space.xs, paddingHorizontal: theme.space.md, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.critical },
  revertBtnText: { color: theme.color.critical, fontWeight: '700', fontSize: theme.font.small },
  revertNote: { fontSize: theme.font.small, color: theme.color.textMuted, fontStyle: 'italic' },

  emptyCard: { backgroundColor: theme.color.surfaceAlt, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, borderStyle: 'dashed', padding: theme.space.xl, alignItems: 'center', gap: theme.space.xs },
  emptyTitle: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.good },
  emptyBody: { fontSize: theme.font.body, color: theme.color.textMuted },

  // Detail panel (slide from right)
  panelBackdrop: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.4)' },
  panelDismiss: { flex: 1 },
  panel: { width: 420, backgroundColor: theme.color.surface, ...theme.shadow.card },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: theme.space.xl, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  panelTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text, flex: 1 },
  panelClose: { fontSize: 18, color: theme.color.textMuted, padding: theme.space.sm },
  panelBody: { padding: theme.space.xl, gap: theme.space.lg },

  detailSection: { gap: theme.space.sm },
  detailSectionTitle: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: theme.space.xs },
  detailRow: { flexDirection: 'row', gap: theme.space.md, flexWrap: 'wrap' },
  detailLabel: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted, minWidth: 100 },
  detailValue: { fontSize: theme.font.small, color: theme.color.text, flex: 1 },
  detailMono: { fontFamily: 'monospace', fontSize: theme.font.tiny },
  itemsList: { gap: theme.space.xs, marginTop: theme.space.xs },

  // Revert modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },
  modalBox: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, padding: theme.space.xl, width: '100%', maxWidth: 480, gap: theme.space.md, ...theme.shadow.card },
  modalTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  modalBody: { fontSize: theme.font.body, color: theme.color.textMuted, lineHeight: 21 },
  label: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  noteInput: { borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md, padding: theme.space.md, fontSize: theme.font.body, color: theme.color.text, backgroundColor: theme.color.surfaceAlt, minHeight: 72 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.space.md },
  ghostBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg },
  ghostBtnText: { color: theme.color.textMuted, fontWeight: '600', fontSize: theme.font.body },
  revertConfirmBtn: { backgroundColor: theme.color.critical, borderRadius: theme.radius.md, paddingVertical: theme.space.sm, paddingHorizontal: theme.space.xl, alignItems: 'center', minWidth: 120 },
  busyBtn: { opacity: 0.6 },
  revertConfirmText: { color: '#fff', fontWeight: '700', fontSize: theme.font.body },
});
