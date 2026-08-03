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
import { api, recordPayment } from '../api';
import { formatRupees, theme } from '../theme';
import { useLang } from '../i18n/LanguageContext';

interface AdminShop {
  id: string;
  shortId?: string | null;
  name: string;
  shopCategory: string;
  city: string;
  verificationStatus: string;
  isOpen: boolean;
  commissionRate: number;
  outstandingDuesPaise: number;
  creditLimitPaise: number;
  contactPhone: string | null;
  ownerLoginOtp?: string | null;
  ownerLoginPin?: string | null;
}

type StatusTone = 'good' | 'warning' | 'info' | 'critical';

function statusMeta(status: string): { label: string; tone: StatusTone; color: string; bg: string } {
  switch (status) {
    case 'APPROVED':   return { label: 'Approved',       tone: 'good',     color: theme.color.good,     bg: theme.color.goodBg };
    case 'PENDING_REVIEW': return { label: 'Pending',    tone: 'warning',  color: theme.color.warning,  bg: theme.color.warningBg };
    case 'SUSPENDED':  return { label: 'Suspended',      tone: 'critical', color: theme.color.critical, bg: theme.color.criticalBg };
    case 'REJECTED':   return { label: 'Rejected',       tone: 'critical', color: theme.color.critical, bg: theme.color.criticalBg };
    default:           return { label: status,           tone: 'info',     color: theme.color.info,     bg: theme.color.infoBg };
  }
}

function ratePct(rate: number): string {
  const pct = rate * 100;
  return Number.isInteger(pct) ? String(pct) : String(Number(pct.toFixed(4)));
}

function categoryLabel(cat: string): string {
  return cat.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function ShopsScreen() {
  const { t } = useLang();
  const [shops, setShops] = useState<AdminShop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [cityInput, setCityInput] = useState('');
  const [city, setCity] = useState('');
  const [search, setSearch] = useState('');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [commDraft, setCommDraft] = useState<Record<string, string>>({});
  const [confirmPayId, setConfirmPayId] = useState<string | null>(null);
  const [payShopId, setPayShopId] = useState<string | null>(null);
  const [payShopDraft, setPayShopDraft] = useState<Record<string, string>>({});

  const load = useCallback(async (cityFilter: string) => {
    setLoading(true); setError(null); setForbidden(false);
    try {
      const data = (await api.adminAllShops(cityFilter.trim() || undefined)) as AdminShop[];
      setShops(data);
      const drafts: Record<string, string> = {};
      for (const s of data) drafts[s.id] = ratePct(s.commissionRate);
      setCommDraft(drafts);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else setError((e as Error).message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(city); }, [load, city]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(city); } finally { setRefreshing(false); }
  }, [load, city]);

  function flash(msg: string) {
    setBanner(msg);
    setTimeout(() => setBanner(null), 3500);
  }

  async function saveCommission(shop: AdminShop) {
    const pct = Number((commDraft[shop.id] ?? '').trim());
    if (Number.isNaN(pct) || pct < 0) { flash('Enter a valid commission %.'); return; }
    setBusyId(shop.id);
    try {
      await api.adminSetCommission(shop.id, pct / 100);
      flash(`Commission set to ${pct}% for ${shop.name}.`);
      await load(city);
    } catch (e) { flash(`Failed: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  }

  async function doRecordPayment(shop: AdminShop) {
    setBusyId(shop.id);
    try {
      await recordPayment(shop.id);
      flash(`Payment recorded for ${shop.name}.`);
      setConfirmPayId(null);
      await load(city);
    } catch (e) { flash(`Failed: ${(e as Error).message}`); setConfirmPayId(null); }
    finally { setBusyId(null); }
  }

  async function doPayShop(shop: AdminShop) {
    // Negative balance = PassWaala owes the shop; the payable amount is its magnitude.
    const payablePaise = Math.max(0, -shop.outstandingDuesPaise);
    const rupees = Number((payShopDraft[shop.id] ?? '').trim());
    if (Number.isNaN(rupees) || rupees <= 0) { flash('Enter a valid amount in ₹.'); return; }
    const amountPaise = Math.round(rupees * 100);
    if (amountPaise > payablePaise) { flash(`Amount exceeds payable (${formatRupees(payablePaise)}).`); return; }
    setBusyId(shop.id);
    try {
      await api.adminPayShopPayable(shop.id, amountPaise);
      flash(`Paid ${formatRupees(amountPaise)} to ${shop.name}.`);
      setPayShopId(null);
      setPayShopDraft(p => ({ ...p, [shop.id]: '' }));
      await load(city);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) flash('Access denied — admin/owner only.');
      else flash(`Pay shop failed: ${(e as Error).message}`);
      setPayShopId(null);
    } finally { setBusyId(null); }
  }

  async function suspend(shop: AdminShop) {    setBusyId(shop.id);
    try {
      await api.adminSuspendShop(shop.id);
      flash(`${shop.name} suspended.`);
      await load(city);
    } catch (e) { flash(`Failed: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  }

  async function reactivate(shop: AdminShop) {
    setBusyId(shop.id);
    try {
      await api.adminReactivateShop(shop.id);
      flash(`${shop.name} reactivated.`);
      await load(city);
    } catch (e) { flash(`Failed: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={theme.color.accent} size="large" /></View>;

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

  const filtered = shops.filter(s => {
    const q = search.toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.city.toLowerCase().includes(q) || s.shopCategory.toLowerCase().includes(q);
  });

  const openCount = filtered.filter(s => s.isOpen).length;
  const duesCount = filtered.filter(s => s.outstandingDuesPaise > 0).length;

  return (
    <View style={styles.wrap}>
      {banner ? <View style={styles.banner}><Text style={styles.bannerText}>{banner}</Text></View> : null}

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View style={styles.pageHeader}>
          <View>
            <Text style={styles.h1}>Shops</Text>
            <Text style={styles.sub}>{filtered.length} shops · {openCount} open · {duesCount} with dues</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable style={styles.refreshBtn} onPress={() => load(city)}>
              <Text style={styles.refreshText}>Refresh</Text>
            </Pressable>
          </View>
        </View>

        {/* Search + city filter */}
        <View style={styles.filterBar}>
          <TextInput
            style={[styles.filterInput, { flex: 2 }]}
            placeholder="Search by name, category…"
            placeholderTextColor={theme.color.textFaint}
            value={search}
            onChangeText={setSearch}
            clearButtonMode="while-editing"
          />
          <TextInput
            style={[styles.filterInput, { flex: 1 }]}
            placeholder="City"
            placeholderTextColor={theme.color.textFaint}
            autoCapitalize="words"
            autoCorrect={false}
            value={cityInput}
            onChangeText={setCityInput}
            onSubmitEditing={() => setCity(cityInput.trim())}
            returnKeyType="search"
          />
          <Pressable style={styles.filterBtn} onPress={() => setCity(cityInput.trim())}>
            <Text style={styles.filterBtnText}>Filter</Text>
          </Pressable>
          {city ? (
            <Pressable onPress={() => { setCityInput(''); setCity(''); }}>
              <Text style={styles.clearText}>✕</Text>
            </Pressable>
          ) : null}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {filtered.length === 0 && !error ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No shops found</Text>
            <Text style={styles.emptyBody}>{city ? `No shops in "${city}".` : 'No shops registered yet.'}</Text>
          </View>
        ) : (
          /* Table */
          <View style={styles.table}>
            {/* Table header */}
            <View style={[styles.tableRow, styles.tableHead]}>
              <Text style={[styles.col, styles.colName, styles.th]}>Shop</Text>
              <Text style={[styles.col, styles.colCity, styles.th]}>City</Text>
              <Text style={[styles.col, styles.colStatus, styles.th]}>Status</Text>
              <Text style={[styles.col, styles.colComm, styles.th]}>Commission</Text>
              <Text style={[styles.col, styles.colDues, styles.th]}>Dues</Text>
              <Text style={[styles.col, styles.colAction, styles.th]}></Text>
            </View>

            {filtered.map((shop, i) => {
              const meta = statusMeta(shop.verificationStatus);
              const hasDues = shop.outstandingDuesPaise > 0;
              const payablePaise = Math.max(0, -shop.outstandingDuesPaise);
              const hasPayable = payablePaise > 0;
              const busy = busyId === shop.id;
              const expanded = expandedId === shop.id;
              const confirming = confirmPayId === shop.id;
              const payingShop = payShopId === shop.id;

              return (
                <View key={shop.id}>
                  <Pressable
                    style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt, expanded && styles.tableRowExpanded]}
                    onPress={() => setExpandedId(expanded ? null : shop.id)}
                  >
                    {/* Shop name + open dot */}
                    <View style={[styles.col, styles.colName, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                      <View style={[styles.openDot, { backgroundColor: shop.isOpen ? theme.color.good : theme.color.textFaint }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.shopName} numberOfLines={1}>{shop.name}</Text>
                        <Text style={styles.shopCat}>{categoryLabel(shop.shopCategory)}</Text>
                      </View>
                    </View>

                    {/* City */}
                    <Text style={[styles.col, styles.colCity, styles.cellText]} numberOfLines={1}>{shop.city}</Text>

                    {/* Status badge */}
                    <View style={[styles.col, styles.colStatus]}>
                      <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                        <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                      </View>
                    </View>

                    {/* Commission */}
                    <Text style={[styles.col, styles.colComm, styles.cellText]}>{ratePct(shop.commissionRate)}%</Text>

                    {/* Dues (positive = shop owes; negative = PassWaala owes shop) */}
                    <Text style={[styles.col, styles.colDues, styles.cellText, hasDues && { color: theme.color.warning, fontWeight: '700' }, hasPayable && { color: theme.color.info, fontWeight: '700' }]}>
                      {hasDues ? formatRupees(shop.outstandingDuesPaise) : hasPayable ? `+${formatRupees(payablePaise)}` : '—'}
                    </Text>

                    {/* Expand chevron */}
                    <View style={[styles.col, styles.colAction, { alignItems: 'flex-end' }]}>
                      <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
                    </View>
                  </Pressable>

                  {/* Expanded action panel */}
                  {expanded && (
                    <View style={styles.expandPanel}>
                      {/* Stats row */}
                      <View style={styles.panelStats}>
                        <PanelStat label="Outstanding Dues" value={formatRupees(shop.outstandingDuesPaise)} warn={hasDues} />
                        {hasPayable ? <PanelStat label="Payable to Shop" value={formatRupees(payablePaise)} /> : null}
                        <PanelStat label="Credit Limit" value={formatRupees(shop.creditLimitPaise)} />
                        <PanelStat label="Commission" value={`${ratePct(shop.commissionRate)}%`} />
                        {shop.contactPhone ? <PanelStat label="Phone" value={shop.contactPhone} /> : null}
                        {shop.ownerLoginPin ? <PanelStat label="Login PIN" value={shop.ownerLoginPin} /> : null}
                      </View>

                      {/* Commission setter */}
                      <View style={styles.panelRow}>
                        <View style={styles.commFieldWrap}>
                          <Text style={styles.panelLabel}>Set Commission %</Text>
                          <TextInput
                            style={styles.commInput}
                            keyboardType="decimal-pad"
                            placeholder="e.g. 2"
                            placeholderTextColor={theme.color.textFaint}
                            value={commDraft[shop.id] ?? ''}
                            onChangeText={val => setCommDraft(p => ({ ...p, [shop.id]: val }))}
                          />
                        </View>
                        <Pressable
                          style={[styles.panelBtn, { backgroundColor: theme.color.primary }]}
                          onPress={() => saveCommission(shop)}
                          disabled={busy}
                        >
                          {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.panelBtnText}>Save</Text>}
                        </Pressable>
                      </View>

                      {/* Payment + suspend */}
                      {confirming ? (
                        <View style={styles.confirmBox}>
                          <Text style={styles.confirmText}>
                            Record payment for <Text style={{ fontWeight: '800' }}>{shop.name}</Text>?
                            {hasDues ? ` Clears ${formatRupees(shop.outstandingDuesPaise)} in dues.` : ''}
                          </Text>
                          <View style={styles.panelActions}>
                            <Pressable style={[styles.panelBtn, { backgroundColor: theme.color.good }]} onPress={() => doRecordPayment(shop)} disabled={busy}>
                              {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.panelBtnText}>Yes, confirm</Text>}
                            </Pressable>
                            <Pressable style={styles.ghostBtn} onPress={() => setConfirmPayId(null)}>
                              <Text style={styles.ghostBtnText}>Cancel</Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : payingShop ? (
                        <View style={styles.payShopBox}>
                          <Text style={styles.confirmText}>
                            Pay <Text style={{ fontWeight: '800' }}>{shop.name}</Text> — PassWaala owes {formatRupees(payablePaise)}.
                          </Text>
                          <View style={styles.panelRow}>
                            <View style={styles.commFieldWrap}>
                              <Text style={styles.panelLabel}>Amount ₹</Text>
                              <TextInput
                                style={styles.commInput}
                                keyboardType="decimal-pad"
                                placeholder="Amount"
                                placeholderTextColor={theme.color.textFaint}
                                value={payShopDraft[shop.id] ?? ''}
                                onChangeText={val => setPayShopDraft(p => ({ ...p, [shop.id]: val }))}
                              />
                            </View>
                            <Pressable style={[styles.panelBtn, { backgroundColor: theme.color.info }]} onPress={() => doPayShop(shop)} disabled={busy}>
                              {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.panelBtnText}>Pay shop</Text>}
                            </Pressable>
                            <Pressable style={styles.ghostBtn} onPress={() => setPayShopId(null)}>
                              <Text style={styles.ghostBtnText}>Cancel</Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : (
                        <View style={styles.panelActions}>
                          {shop.verificationStatus === 'APPROVED' && (
                            <Pressable
                              style={[styles.panelBtn, { backgroundColor: hasDues ? theme.color.accent : theme.color.surfaceAlt, borderWidth: hasDues ? 0 : 1, borderColor: theme.color.borderStrong }]}
                              onPress={() => setConfirmPayId(shop.id)}
                            >
                              <Text style={[styles.panelBtnText, { color: hasDues ? '#fff' : theme.color.text }]}>
                                {hasDues ? `Record ₹${(shop.outstandingDuesPaise / 100).toFixed(2)} paid` : 'Record payment'}
                              </Text>
                            </Pressable>
                          )}
                          {hasPayable && (
                            <Pressable
                              style={[styles.panelBtn, { backgroundColor: theme.color.info }]}
                              onPress={() => {
                                setPayShopDraft(p => ({ ...p, [shop.id]: (payablePaise / 100).toFixed(2) }));
                                setPayShopId(shop.id);
                              }}
                            >
                              <Text style={styles.panelBtnText}>{`Pay shop ${formatRupees(payablePaise)}`}</Text>
                            </Pressable>
                          )}
                          {shop.verificationStatus === 'APPROVED' && (
                            <Pressable style={[styles.panelBtn, { backgroundColor: theme.color.criticalBg, borderWidth: 1, borderColor: theme.color.critical }]} onPress={() => suspend(shop)} disabled={busy}>
                              <Text style={[styles.panelBtnText, { color: theme.color.critical }]}>Suspend</Text>
                            </Pressable>
                          )}
                          {shop.verificationStatus === 'SUSPENDED' && (
                            <Pressable style={[styles.panelBtn, { backgroundColor: theme.color.good }]} onPress={() => reactivate(shop)} disabled={busy}>
                              {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.panelBtnText}>Reactivate</Text>}
                            </Pressable>
                          )}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function PanelStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.panelStat}>
      <Text style={styles.panelStatLabel}>{label}</Text>
      <Text style={[styles.panelStatValue, warn && { color: theme.color.warning }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { padding: theme.space.xl, gap: theme.space.lg, paddingBottom: theme.space.xxxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },

  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  h1: { fontSize: theme.font.h1, fontWeight: '800', color: theme.color.text },
  sub: { fontSize: theme.font.body, color: theme.color.textMuted, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: theme.space.sm },
  refreshBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.borderStrong, backgroundColor: theme.color.surface },
  refreshText: { color: theme.color.text, fontWeight: '600', fontSize: theme.font.small },

  filterBar: { flexDirection: 'row', gap: theme.space.sm, alignItems: 'center' },
  filterInput: {
    borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md,
    padding: theme.space.md, fontSize: theme.font.body, color: theme.color.text,
    backgroundColor: theme.color.surfaceAlt,
  },
  filterBtn: { backgroundColor: theme.color.accent, borderRadius: theme.radius.md, paddingVertical: theme.space.md, paddingHorizontal: theme.space.lg },
  filterBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.small },
  clearText: { color: theme.color.textMuted, fontWeight: '700', fontSize: theme.font.body, padding: theme.space.sm },

  // Table
  table: {
    backgroundColor: theme.color.surface, borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: theme.color.border, overflow: 'hidden',
    ...theme.shadow.card,
  },
  tableHead: { backgroundColor: theme.color.surfaceAlt },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  tableRowAlt: { backgroundColor: '#FAFBFC' },
  tableRowExpanded: { backgroundColor: theme.color.infoBg },
  th: { fontSize: theme.font.tiny, fontWeight: '800', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  col: { paddingHorizontal: 4 },
  colName: { flex: 3 },
  colCity: { flex: 1.5 },
  colStatus: { flex: 1.5 },
  colComm: { flex: 1, textAlign: 'right' },
  colDues: { flex: 1.5, textAlign: 'right' },
  colAction: { flex: 0.5 },
  cellText: { fontSize: theme.font.small, color: theme.color.text },

  openDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  shopName: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  shopCat: { fontSize: theme.font.tiny, color: theme.color.textMuted, marginTop: 1 },
  chevron: { fontSize: theme.font.tiny, color: theme.color.textMuted },

  badge: { alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: theme.space.sm, borderRadius: theme.radius.pill },
  badgeText: { fontSize: theme.font.tiny, fontWeight: '700' },

  // Expand panel
  expandPanel: {
    backgroundColor: theme.color.bg, borderBottomWidth: 1, borderBottomColor: theme.color.border,
    paddingHorizontal: theme.space.xl, paddingVertical: theme.space.lg, gap: theme.space.md,
  },
  panelStats: { flexDirection: 'row', gap: theme.space.xl, flexWrap: 'wrap', paddingBottom: theme.space.md, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  panelStat: { gap: 2 },
  panelStatLabel: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  panelStatValue: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },

  panelRow: { flexDirection: 'row', gap: theme.space.sm, alignItems: 'flex-end' },
  commFieldWrap: { gap: theme.space.xs },
  panelLabel: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  commInput: {
    width: 120, borderWidth: 1, borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.md, padding: theme.space.md,
    fontSize: theme.font.body, color: theme.color.text, backgroundColor: theme.color.surfaceAlt,
  },
  panelActions: { flexDirection: 'row', gap: theme.space.sm, flexWrap: 'wrap' },
  panelBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', minWidth: 100 },
  panelBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.small },
  ghostBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg },
  ghostBtnText: { color: theme.color.textMuted, fontWeight: '600', fontSize: theme.font.small },

  confirmBox: { backgroundColor: theme.color.warningBg, borderRadius: theme.radius.md, padding: theme.space.md, gap: theme.space.md },
  payShopBox: { backgroundColor: theme.color.infoBg, borderRadius: theme.radius.md, padding: theme.space.md, gap: theme.space.md },
  confirmText: { fontSize: theme.font.body, color: theme.color.text, lineHeight: 21 },

  empty: { alignItems: 'center', padding: theme.space.xxxl, backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, borderStyle: 'dashed', gap: theme.space.xs },
  emptyTitle: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  emptyBody: { fontSize: theme.font.body, color: theme.color.textMuted },
  error: { color: theme.color.critical, fontSize: theme.font.body },
  banner: { backgroundColor: theme.color.primary, paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl },
  bannerText: { color: '#fff', fontWeight: '600', fontSize: theme.font.small },
  notice: { maxWidth: 420, padding: theme.space.xl, borderRadius: theme.radius.lg, backgroundColor: theme.color.criticalBg, borderWidth: 1, borderColor: '#FCA5A5', gap: theme.space.sm },
  noticeTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.critical },
  noticeBody: { fontSize: theme.font.body, color: theme.color.text, lineHeight: 21 },
});
