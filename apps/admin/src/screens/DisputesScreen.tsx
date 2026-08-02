import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DisputeOrder {
  id: string;
  shortId?: string | null;
  status?: string;
  paymentMethod?: string;
  originalTotalPaise: number;
  adjustedTotalPaise?: number | null;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
  cancelledAt?: string | null;
  refundConfirmedAt?: string | null;
  createdAt?: string;
  shop: { name: string; city?: string | null } | null;
  customer?: { name: string | null; phone: string | null } | null;
}

interface DisputeSummary {
  id: string;
  orderId: string;
  raisedByRole: string;
  reason: string;
  status: string;
  createdAt: string;
  assignedAt?: string | null;
  order: DisputeOrder | null;
  raiser: { name: string | null; phone: string | null } | null;
}

interface DisputeThread extends DisputeSummary {
  messages: Array<{ id: string; senderRole: string; body: string; createdAt: string }>;
}

interface OldDispute {
  orderId: string;
  orderNumber: string;
  status: string;
  cancelledBy: string | null;
  reason: string | null;
  paymentMethod: string;
  totalPaise: number;
  shop: { name: string; city: string } | null;
  createdAt: string;
  updatedAt: string;
}

type RoleTab = 'ALL' | 'CUSTOMER' | 'SHOP' | 'RIDER' | 'SYSTEM';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function waitTime(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

function formatRupees(p: number) { return `₹${(p / 100).toFixed(2)}`; }

function roleColor(role: string) {
  if (role === 'CUSTOMER') return '#2563EB';
  if (role === 'SHOP') return '#15803D';
  if (role === 'RIDER') return '#B45309';
  return '#6B7280';
}

/** One label/value pair in the dispute audit panel. */
function AuditRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.auditRow}>
      <Text style={s.auditLabel}>{label}</Text>
      <Text style={s.auditValue}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function DisputesScreen() {
  const [roleTab, setRoleTab] = useState<RoleTab>('ALL');
  const [subTab, setSubTab] = useState<'queue' | 'mine' | 'resolved' | 'old'>('queue');
  const [queue, setQueue] = useState<DisputeSummary[]>([]);
  const [mine, setMine] = useState<DisputeSummary[]>([]);
  const [resolved, setResolved] = useState<DisputeSummary[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [oldDisputes, setOldDisputes] = useState<OldDispute[]>([]);
  const [oldSearch, setOldSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<DisputeThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  const loadLists = useCallback(async () => {
    setLoading(true); setError(null); setForbidden(false);
    try {
      const role = roleTab === 'ALL' ? undefined : roleTab;
      const [q, m, c, r] = await Promise.all([
        api.adminDisputeQueue(role) as Promise<DisputeSummary[]>,
        api.adminMyDisputes() as Promise<DisputeSummary[]>,
        api.adminDisputeCounts(),
        api.adminResolvedDisputes(role) as Promise<DisputeSummary[]>,
      ]);
      setQueue(q); setMine(m); setCounts(c); setResolved(r);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else setError((e as Error).message);
    } finally { setLoading(false); }
  }, [roleTab]);

  useEffect(() => { void loadLists(); }, [loadLists]);
  useEffect(() => {
    const id = setInterval(() => void loadLists(), 12000);
    return () => clearInterval(id);
  }, [loadLists]);

  const activeList = subTab === 'queue' ? queue : subTab === 'mine' ? mine : subTab === 'resolved' ? resolved : [];

  // Load old disputes when that sub-tab is opened
  useEffect(() => {
    if (subTab !== 'old') return;
    api.adminDisputes({ limit: 50 })
      .then(res => setOldDisputes((res as { items: OldDispute[] }).items ?? []))
      .catch(() => undefined);
  }, [subTab]);

  const loadThread = useCallback(async (id: string) => {
    setThreadLoading(true);
    try {
      const t = (await api.adminDisputeThread(id)) as DisputeThread;
      setThread(t);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
    } catch { /* keep previous */ }
    finally { setThreadLoading(false); }
  }, []);

  useEffect(() => {
    if (!selected) return;
    void loadThread(selected);
    const id = setInterval(() => void loadThread(selected), 10000);
    return () => clearInterval(id);
  }, [selected, loadThread]);

  async function claim(disputeId: string) {
    setClaimingId(disputeId); setError(null);
    try {
      await api.adminAssignDispute(disputeId);
      await loadLists();
      setSelected(disputeId);
      setSubTab('mine');
    } catch (e) { setError((e as Error).message); }
    finally { setClaimingId(null); }
  }

  async function resolve() {
    if (!selected) return;
    setResolvingId(selected); setError(null);
    try {
      await api.adminResolveDispute(selected);
      await loadLists();
      await loadThread(selected);
    } catch (e) { setError((e as Error).message); }
    finally { setResolvingId(null); }
  }

  async function send() {
    if (!message.trim() || !selected) return;
    setSending(true); setError(null);
    try {
      await api.adminSendDisputeMessage(selected, message.trim());
      setMessage('');
      await loadThread(selected);
    } catch (e) { setError((e as Error).message); }
    finally { setSending(false); }
  }

  if (forbidden) return (
    <View style={s.center}>
      <Text style={s.noticeTitle}>Access denied</Text>
      <Text style={s.noticeSub}>Log in with an admin account.</Text>
    </View>
  );

  const ROLE_TABS: RoleTab[] = ['ALL', 'CUSTOMER', 'SHOP', 'RIDER', 'SYSTEM'];
  const hasActiveDispute = mine.length > 0;

  // Scope label: the queue is city-scoped server-side. Derive the admin's scope
  // from the cities present across the loaded disputes — one distinct city means
  // a city-scoped admin; multiple (or none) reads as "All cities" (OWNER).
  const scopeCities = Array.from(
    new Set(
      [...queue, ...mine, ...resolved]
        .map(d => d.order?.shop?.city)
        .filter((c): c is string => !!c),
    ),
  );
  const scopeLabel = scopeCities.length === 1 ? scopeCities[0] : 'All cities';

  // Filter old disputes by search
  const q = oldSearch.trim().toLowerCase();
  const filteredOld = oldDisputes.filter(d =>
    !q ||
    d.orderNumber.toLowerCase().includes(q) ||
    d.shop?.name.toLowerCase().includes(q) ||
    d.cancelledBy?.toLowerCase().includes(q) ||
    d.reason?.toLowerCase().includes(q)
  );

  return (
    <View style={s.root}>
      {/* ── Left panel ── */}
      <View style={s.left}>
        {/* Scope banner — which city's disputes this admin sees */}
        <View style={s.scopeBar}>
          <Text style={s.scopeText}>📍 {scopeLabel}</Text>
        </View>
        {/* Role filter tabs */}
        <View style={s.roleTabs}>
          {ROLE_TABS.map(r => {
            const count = r === 'ALL'
              ? Object.values(counts).reduce((a, b) => a + b, 0)
              : (counts[r] ?? 0);
            return (
              <Pressable key={r} style={[s.roleTab, roleTab === r && s.roleTabActive]} onPress={() => setRoleTab(r)}>
                <Text style={[s.roleTabText, roleTab === r && s.roleTabTextActive]}>
                  {r === 'ALL' ? 'All' : r === 'SHOP' ? 'Shop' : r.charAt(0) + r.slice(1).toLowerCase()}
                  {count > 0 ? ` (${count})` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Sub-tabs */}
        <View style={s.subTabs}>
          {(['queue', 'mine', 'resolved', 'old'] as const).map(t => (
            <Pressable key={t} style={[s.subTab, subTab === t && s.subTabActive]} onPress={() => setSubTab(t)}>
              <Text style={[s.subTabText, subTab === t && s.subTabTextActive]}>
                {t === 'queue' ? `Queue (${queue.length})` : t === 'mine' ? `Mine (${mine.length})` : t === 'resolved' ? `Done (${resolved.length})` : 'Auto-cancelled'}
              </Text>
            </Pressable>
          ))}
        </View>

        {error ? <Text style={s.err}>{error}</Text> : null}

        {subTab === 'old' ? (
          // Old disputes — cancelled / refund-pending read-only list
          <>
            <TextInput
              style={s.searchInput}
              placeholder="Search by order #, shop, reason…"
              placeholderTextColor={theme.color.textFaint}
              value={oldSearch}
              onChangeText={setOldSearch}
              autoCorrect={false}
            />
            <ScrollView style={s.listScroll}>
              {filteredOld.length === 0 ? (
                <View style={s.center}><Text style={s.empty}>No auto-cancelled orders found</Text></View>
              ) : filteredOld.map(d => (
                <View key={d.orderId} style={s.oldRow}>
                  <View style={s.oldRowTop}>
                    <Text style={s.oldOrderNo}>#{d.orderNumber}</Text>
                    <View style={[s.oldStatusChip, { backgroundColor: d.status === 'REFUND_PENDING' ? '#FEF3C7' : '#FEE2E2' }]}>
                      <Text style={[s.oldStatusText, { color: d.status === 'REFUND_PENDING' ? '#B45309' : '#B91C1C' }]}>{d.status.replace('_', ' ')}</Text>
                    </View>
                  </View>
                  <Text style={s.oldShop}>{d.shop?.name ?? '—'} · {d.shop?.city ?? ''}</Text>
                  <Text style={s.oldMeta}>
                    {formatRupees(d.totalPaise)} · {d.paymentMethod}
                    {d.cancelledBy ? ` · by ${d.cancelledBy.toLowerCase()}` : ''}
                  </Text>
                  {d.reason ? <Text style={s.oldReason} numberOfLines={2}>{d.reason}</Text> : null}
                  <Text style={s.oldDate}>{fmtDate(d.updatedAt)}</Text>
                </View>
              ))}
            </ScrollView>
          </>
        ) : loading ? (
          <View style={s.center}><ActivityIndicator color={theme.color.accent} /></View>
        ) : activeList.length === 0 ? (
          <View style={s.center}>
            <Text style={s.empty}>{subTab === 'queue' ? 'No pending disputes' : subTab === 'mine' ? 'No active disputes assigned to you' : 'No resolved disputes yet'}</Text>
          </View>
        ) : (
          <ScrollView style={s.listScroll}>
            {activeList.map(d => (
              <Pressable
                key={d.id}
                style={[s.row, selected === d.id && s.rowActive]}
                onPress={() => setSelected(d.id)}
              >
                <View style={s.rowTop}>
                  <View style={[s.roleChip, { backgroundColor: roleColor(d.raisedByRole) + '22' }]}>
                    <Text style={[s.roleChipText, { color: roleColor(d.raisedByRole) }]}>{d.raisedByRole}</Text>
                  </View>
                  <Text style={s.rowTime}>{waitTime(d.createdAt)}</Text>
                </View>
                <Text style={s.rowOrder}>#{d.orderId.slice(0, 8).toUpperCase()} · {d.order?.shop?.name ?? '—'}</Text>
                <Text style={s.rowRaiser}>{d.raiser?.name ?? '—'} · {d.raiser?.phone ?? ''}</Text>
                <Text style={s.rowReason} numberOfLines={2}>{d.reason}</Text>
                {subTab === 'queue' ? (
                  <Pressable
                    style={[s.claimBtn, (hasActiveDispute || claimingId !== null) && s.claimBtnDisabled]}
                    disabled={hasActiveDispute || claimingId !== null}
                    onPress={() => claim(d.id)}
                  >
                    {claimingId === d.id
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={s.claimBtnText}>{hasActiveDispute ? 'Resolve yours first' : 'Claim'}</Text>}
                  </Pressable>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      {/* ── Right panel — chat thread ── */}
      <View style={s.right}>
        {!selected || subTab === 'old' ? (          <View style={s.center}>
            <Text style={s.empty}>Select a dispute to view the conversation</Text>
          </View>
        ) : threadLoading && !thread ? (
          <View style={s.center}><ActivityIndicator color={theme.color.accent} /></View>
        ) : thread ? (
          <>
            <View style={s.threadHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.threadTitle}>#{thread.orderId.slice(0, 8).toUpperCase()}</Text>
                <Text style={s.threadSub}>
                  {thread.order?.shop?.name ?? '—'} · {thread.order ? formatRupees(thread.order.adjustedTotalPaise ?? thread.order.originalTotalPaise) : ''}
                </Text>
                <Text style={s.threadRaiser}>
                  {thread.raiser?.name ?? '—'} ({thread.raisedByRole.toLowerCase()}) · {thread.raiser?.phone ?? ''}
                </Text>
                <Text style={s.threadReason}>"{thread.reason}"</Text>
              </View>
              {thread.status !== 'RESOLVED' ? (
                <Pressable style={[s.resolveBtn, !!resolvingId && s.resolveBtnBusy]} onPress={resolve} disabled={!!resolvingId}>
                  {resolvingId ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.resolveBtnText}>Mark resolved</Text>}
                </Pressable>
              ) : (
                <View style={s.resolvedChip}><Text style={s.resolvedText}>✅ Resolved</Text></View>
              )}
            </View>

            {/* Audit panel — full "what happened" description for the admin */}
            {thread.order ? (
              <View style={s.auditPanel}>
                <Text style={s.auditTitle}>Order audit</Text>
                <View style={s.auditGrid}>
                  <AuditRow label="Order" value={`#${(thread.order.shortId || thread.order.id.slice(0, 8)).toUpperCase()}`} />
                  <AuditRow label="Amount" value={formatRupees(thread.order.adjustedTotalPaise ?? thread.order.originalTotalPaise)} />
                  {thread.order.shop?.city ? <AuditRow label="City" value={thread.order.shop.city} /> : null}
                  <AuditRow label="Shop" value={thread.order.shop?.name ?? '—'} />
                  {thread.order.customer ? (
                    <AuditRow label="Customer" value={`${thread.order.customer.name ?? '—'} · ${thread.order.customer.phone ?? ''}`} />
                  ) : null}
                  {thread.order.paymentMethod ? <AuditRow label="Payment" value={thread.order.paymentMethod} /> : null}
                  {thread.order.status ? <AuditRow label="Status" value={thread.order.status.replace(/_/g, ' ')} /> : null}
                  {thread.order.createdAt ? <AuditRow label="Placed" value={fmtDate(thread.order.createdAt)} /> : null}
                  {thread.order.cancelledBy ? <AuditRow label="Cancelled by" value={thread.order.cancelledBy.toLowerCase()} /> : null}
                  {thread.order.cancelledAt ? <AuditRow label="Cancelled" value={fmtDate(thread.order.cancelledAt)} /> : null}
                  {thread.order.refundConfirmedAt ? <AuditRow label="Refund confirmed" value={fmtDate(thread.order.refundConfirmedAt)} /> : null}
                </View>
                {thread.order.cancellationReason ? (
                  <Text style={s.auditReason}>Reason: {thread.order.cancellationReason}</Text>
                ) : null}
              </View>
            ) : null}

            <ScrollView ref={scrollRef} style={s.messages} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
              {thread.messages.length === 0 ? <Text style={s.noMsg}>No messages yet — start the conversation.</Text> : null}
              {thread.messages.map(msg => {
                const isAdmin = msg.senderRole === 'ADMIN';
                return (
                  <View key={msg.id} style={[s.bubble, isAdmin ? s.bubbleAdmin : s.bubbleUser]}>
                    <Text style={[s.bubbleRole, isAdmin && s.bubbleRoleAdmin]}>
                      {isAdmin ? 'PassWaala Admin' : thread.raisedByRole.charAt(0) + thread.raisedByRole.slice(1).toLowerCase()}
                    </Text>
                    <Text style={s.bubbleBody}>{msg.body}</Text>
                    <Text style={s.bubbleTime}>{fmtDate(msg.createdAt)}</Text>
                  </View>
                );
              })}
            </ScrollView>

            {thread.status !== 'RESOLVED' ? (
              <View style={s.inputRow}>
                <TextInput
                  style={s.input}
                  placeholder="Type a message…"
                  placeholderTextColor={theme.color.textFaint}
                  value={message}
                  onChangeText={setMessage}
                  maxLength={1000}
                  returnKeyType="send"
                  onSubmitEditing={send}
                />
                <Pressable style={[s.sendBtn, (!message.trim() || sending) && s.sendBtnBusy]} onPress={send} disabled={!message.trim() || sending}>
                  {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.sendBtnText}>Send</Text>}
                </Pressable>
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  left: { width: 340, borderRightWidth: 1, borderRightColor: theme.color.border, flexDirection: 'column' },
  right: { flex: 1, flexDirection: 'column' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { color: theme.color.textMuted, fontSize: theme.font.body, textAlign: 'center' },
  err: { color: theme.color.critical, fontSize: theme.font.small, padding: 8 },
  noticeTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.critical },
  noticeSub: { fontSize: theme.font.body, color: theme.color.textMuted },

  scopeBar: { paddingVertical: theme.space.xs, paddingHorizontal: theme.space.md, backgroundColor: theme.color.surfaceAlt, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  scopeText: { fontSize: theme.font.tiny, fontWeight: '800', color: theme.color.textMuted },

  auditPanel: { padding: theme.space.md, backgroundColor: theme.color.surfaceAlt, borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: theme.space.xs },
  auditTitle: { fontSize: theme.font.tiny, fontWeight: '800', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  auditGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  auditRow: { minWidth: '30%', gap: 1 },
  auditLabel: { fontSize: theme.font.tiny, color: theme.color.textFaint },
  auditValue: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  auditReason: { fontSize: theme.font.small, color: theme.color.textMuted, fontStyle: 'italic', marginTop: 2 },

  roleTabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.color.border },  roleTab: { flex: 1, paddingVertical: theme.space.sm, alignItems: 'center' },
  roleTabActive: { borderBottomWidth: 2, borderBottomColor: theme.color.accent },
  roleTabText: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textMuted },
  roleTabTextActive: { color: theme.color.accent },

  subTabs: { flexDirection: 'row', padding: theme.space.sm, gap: theme.space.xs },
  subTab: { flex: 1, paddingVertical: theme.space.xs, alignItems: 'center', borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  subTabActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  subTabText: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textMuted },
  subTabTextActive: { color: '#fff' },

  searchInput: {
    margin: theme.space.sm, borderWidth: 1, borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.md, padding: theme.space.sm, fontSize: theme.font.small,
    color: theme.color.text, backgroundColor: theme.color.surfaceAlt,
  },
  listScroll: { flex: 1 },
  row: { padding: theme.space.md, borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: theme.space.xs },
  rowActive: { backgroundColor: theme.color.surfaceAlt },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  roleChip: { paddingVertical: 2, paddingHorizontal: theme.space.sm, borderRadius: theme.radius.pill },
  roleChipText: { fontSize: theme.font.tiny, fontWeight: '800' },
  rowTime: { fontSize: theme.font.tiny, color: theme.color.textFaint },
  rowOrder: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  rowRaiser: { fontSize: theme.font.small, color: theme.color.textMuted },
  rowReason: { fontSize: theme.font.small, color: theme.color.textMuted, fontStyle: 'italic' },
  claimBtn: { marginTop: theme.space.xs, backgroundColor: theme.color.accent, borderRadius: theme.radius.md, paddingVertical: 6, alignItems: 'center' },
  claimBtnDisabled: { backgroundColor: theme.color.border },
  claimBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.small },

  oldRow: { padding: theme.space.md, borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: 3 },
  oldRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  oldOrderNo: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.text },
  oldStatusChip: { paddingVertical: 2, paddingHorizontal: theme.space.sm, borderRadius: theme.radius.pill },
  oldStatusText: { fontSize: theme.font.tiny, fontWeight: '800' },
  oldShop: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  oldMeta: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  oldReason: { fontSize: theme.font.tiny, color: theme.color.textMuted, fontStyle: 'italic' },
  oldDate: { fontSize: theme.font.tiny, color: theme.color.textFaint },

  threadHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md, padding: theme.space.lg, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  threadTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  threadSub: { fontSize: theme.font.small, color: theme.color.textMuted },
  threadRaiser: { fontSize: theme.font.small, color: theme.color.textMuted },
  threadReason: { fontSize: theme.font.small, color: theme.color.textMuted, fontStyle: 'italic', marginTop: 2 },
  resolveBtn: { backgroundColor: theme.color.good, borderRadius: theme.radius.md, paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, alignItems: 'center' },
  resolveBtnBusy: { opacity: 0.6 },
  resolveBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.small },
  resolvedChip: { backgroundColor: theme.color.goodBg, borderRadius: theme.radius.md, paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg },
  resolvedText: { color: theme.color.good, fontWeight: '700', fontSize: theme.font.small },

  messages: { flex: 1, padding: theme.space.lg },
  noMsg: { textAlign: 'center', color: theme.color.textFaint, fontSize: theme.font.small },
  bubble: { maxWidth: '70%', marginBottom: theme.space.sm, padding: theme.space.md, borderRadius: theme.radius.lg, gap: 2 },
  bubbleAdmin: { alignSelf: 'flex-end', backgroundColor: '#DBEAFE' },
  bubbleUser: { alignSelf: 'flex-start', backgroundColor: theme.color.surfaceAlt, borderWidth: 1, borderColor: theme.color.border },
  bubbleRole: { fontSize: theme.font.tiny, fontWeight: '800', color: theme.color.textMuted },
  bubbleRoleAdmin: { color: theme.color.accent },
  bubbleBody: { fontSize: theme.font.body, color: theme.color.text },
  bubbleTime: { fontSize: theme.font.tiny, color: theme.color.textFaint, alignSelf: 'flex-end' },

  inputRow: { flexDirection: 'row', gap: theme.space.sm, padding: theme.space.md, borderTopWidth: 1, borderTopColor: theme.color.border },
  input: { flex: 1, borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md, paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm, fontSize: theme.font.body, color: theme.color.text, backgroundColor: theme.color.surfaceAlt },
  sendBtn: { backgroundColor: theme.color.accent, borderRadius: theme.radius.md, paddingHorizontal: theme.space.lg, justifyContent: 'center', alignItems: 'center', minWidth: 70 },
  sendBtnBusy: { opacity: 0.5 },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.small },
});
