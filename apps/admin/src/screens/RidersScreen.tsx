import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '@passwaala/api-client';
import { api } from '../api';
import { formatRupees, theme } from '../theme';
import { useLang } from '../i18n/LanguageContext';

type AdminRider = Awaited<ReturnType<typeof api.adminListRiders>>[number];
type ActiveOrder = AdminRider['activeOrders'][number];
type RiderDetail = Awaited<ReturnType<typeof api.adminRiderDetail>>;
type RecentOrder = RiderDetail['recentOrders'][number];

type Tab = 'all' | 'online' | 'offline';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function RidersScreen() {
  const { t } = useLang();
  const [riders, setRiders] = useState<AdminRider[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [payEarningsId, setPayEarningsId] = useState<string | null>(null);
  const [earningsDraft, setEarningsDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [cityInput, setCityInput] = useState('');
  const [city, setCity] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RiderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const openDetail = useCallback(async (userId: string) => {
    setDetailId(userId);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const data = await api.adminRiderDetail(userId);
      setDetail(data);
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function closeDetail() {
    setDetailId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }

  const load = useCallback(async (cityFilter: string = city) => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const data = await api.adminListRiders(cityFilter.trim() || undefined);
      setRiders(data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [city]);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  function flash(msg: string) {
    setBanner(msg);
    setTimeout(() => setBanner(null), 3500);
  }

  async function doRecordPayment(rider: AdminRider) {
    setBusyId(rider.userId);
    try {
      await api.adminRecordRiderPayment(rider.userId);
      flash(t.riders.depositRecorded(formatRupees(rider.duesPaise), rider.name || t.riders.riderLower));
      setConfirmId(null);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) flash(t.common.accessDeniedAdminOwner);
      else flash(t.riders.recordPaymentFailed((e as Error).message));
      setConfirmId(null);
    } finally {
      setBusyId(null);
    }
  }

  async function doPayEarnings(rider: AdminRider) {
    const rupees = Number((earningsDraft[rider.userId] ?? '').trim());
    if (Number.isNaN(rupees) || rupees <= 0) {
      flash('Enter a valid amount in ₹.');
      return;
    }
    const amountPaise = Math.round(rupees * 100);
    if (amountPaise > rider.earningsPaise) {
      flash(`Amount exceeds available earnings (${formatRupees(rider.earningsPaise)}).`);
      return;
    }
    setBusyId(rider.userId);
    try {
      await api.adminPayRiderEarnings(rider.userId, amountPaise);
      flash(`Paid ${formatRupees(amountPaise)} to ${rider.name || t.riders.riderLower}.`);
      setPayEarningsId(null);
      setEarningsDraft(p => ({ ...p, [rider.userId]: '' }));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) flash(t.common.accessDeniedAdminOwner);
      else flash(`Pay earnings failed: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  if (loading && riders.length === 0) {
    return <View style={styles.center}><ActivityIndicator color={theme.color.accent} size="large" /></View>;
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

  const q = search.trim().toLowerCase();
  const byTab = tab === 'online' ? riders.filter(r => r.online)
    : tab === 'offline' ? riders.filter(r => !r.online)
    : riders;
  const filtered = q
    ? byTab.filter(r =>
        (r.name ?? '').toLowerCase().includes(q) ||
        (r.phone ?? '').toLowerCase().includes(q) ||
        (r.vehicle ?? '').toLowerCase().includes(q)
      )
    : byTab;

  const onlineCount = riders.filter(r => r.online).length;
  const offlineCount = riders.filter(r => !r.online).length;

  return (
    <View style={styles.wrap}>
      {banner ? (
        <View style={styles.banner}><Text style={styles.bannerText}>{banner}</Text></View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View style={styles.pageHeader}>
          <View>
            <Text style={styles.h1}>{t.riders.title}</Text>
            <Text style={styles.sub}>
              {riders.length} total · {onlineCount} online · {offlineCount} offline
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable style={styles.refreshBtn} onPress={() => load()}>
              <Text style={styles.refreshText}>{t.common.refresh}</Text>
            </Pressable>
          </View>
        </View>

        {/* Search + city filter */}
        <View style={styles.filterBar}>
          <TextInput
            style={[styles.filterInput, { flex: 2 }]}
            placeholder="Search by name, phone, vehicle…"
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

        {/* Tabs */}
        <View style={styles.tabs}>
          {([
            { key: 'all', label: `All (${riders.length})` },
            { key: 'online', label: `Online (${onlineCount})` },
            { key: 'offline', label: `Offline (${offlineCount})` },
          ] as { key: Tab; label: string }[]).map(({ key, label }) => (
            <Pressable
              key={key}
              style={[styles.tab, tab === key && styles.tabActive]}
              onPress={() => setTab(key)}
            >
              <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {filtered.length === 0 && !error ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{q || city ? 'No matches' : t.riders.noRiders}</Text>
            <Text style={styles.emptyBody}>
              {city ? `No riders with deliveries in "${city}".` : q ? 'Try a different search.' : t.riders.noRidersBody}
            </Text>
          </View>
        ) : null}

        <View style={styles.list}>
          {filtered.map((rider) => {
            const busy = busyId === rider.userId;
            const hasDues = rider.duesPaise > 0;
            const hasEarnings = rider.earningsPaise > 0;
            const atCap = rider.duesPaise >= rider.creditLimitPaise;
            const confirming = confirmId === rider.userId;
            const payingEarnings = payEarningsId === rider.userId;
            return (
              <View key={rider.userId} style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={[styles.openDot, { backgroundColor: rider.online ? theme.color.good : theme.color.textFaint }]} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.cardTitleRow}>
                      <Text style={styles.cardName}>{rider.name || t.riders.riderDefault}</Text>
                      <StatusBadge online={rider.online} />
                      {atCap ? <Badge label={t.riders.atCodLimit} tone="critical" /> : null}
                      {rider.activeOrders.length > 0 ? (
                        <Badge label={`${rider.activeOrders.length} active`} tone="info" />
                      ) : null}
                    </View>
                    <Text style={styles.cardMeta}>
                      {rider.phone || t.riders.noPhone}{rider.vehicle ? ` · ${rider.vehicle}` : ''}
                      {rider.cities.length ? ` · ${rider.cities.join(', ')}` : ''}
                    </Text>
                    {rider.serviceCity ? (
                      <Text style={styles.cardServiceCity}>{t.riders.serviceCity}: {rider.serviceCity}</Text>
                    ) : null}
                  </View>
                </View>

                <View style={styles.statRow}>
                  <Stat label={t.riders.earnings} value={formatRupees(rider.earningsPaise)} />
                  <Stat label={t.riders.codDues} value={formatRupees(rider.duesPaise)} tone={hasDues ? 'warning' : undefined} />
                  <Stat label={t.riders.codLimit} value={formatRupees(rider.creditLimitPaise)} />
                  <Stat label="Total orders" value={String(rider.totalDeliveries)} />
                  <Stat label="Today" value={String(rider.todayDeliveries)} />
                  {rider.loginPin ? <Stat label="Login PIN" value={rider.loginPin} /> : rider.loginOtp ? <Stat label="Login OTP" value={rider.loginOtp} /> : null}
                </View>

                {/* Active orders */}
                {rider.activeOrders.length > 0 && (
                  <View style={styles.ordersBox}>
                    <Text style={styles.ordersTitle}>Active deliveries</Text>
                    {rider.activeOrders.map(order => (
                      <OrderRow key={order.orderId} order={order} />
                    ))}
                  </View>
                )}

                {confirming ? (
                  <View style={styles.confirmBox}>
                    <Text style={styles.confirmText}>
                      {t.riders.confirmDepositText(rider.name || t.riders.thisRider, formatRupees(rider.duesPaise))}
                    </Text>
                    <View style={styles.actions}>
                      <ActionButton label={t.riders.confirmDeposit} tone="good" busy={busy} onPress={() => doRecordPayment(rider)} />
                      <ActionButton label={t.common.cancel} tone="ghost" onPress={() => setConfirmId(null)} />
                    </View>
                  </View>
                ) : payingEarnings ? (
                  <View style={styles.payBox}>
                    <Text style={styles.confirmText}>
                      Pay earnings to {rider.name || t.riders.thisRider} (available {formatRupees(rider.earningsPaise)}).
                    </Text>
                    <View style={styles.payRow}>
                      <TextInput
                        style={styles.payInput}
                        keyboardType="decimal-pad"
                        placeholder="Amount ₹"
                        placeholderTextColor={theme.color.textFaint}
                        value={earningsDraft[rider.userId] ?? ''}
                        onChangeText={val => setEarningsDraft(p => ({ ...p, [rider.userId]: val }))}
                      />
                      <ActionButton label="Pay" tone="good" busy={busy} onPress={() => doPayEarnings(rider)} />
                      <ActionButton label={t.common.cancel} tone="ghost" onPress={() => setPayEarningsId(null)} />
                    </View>
                  </View>
                ) : (
                  <View style={styles.actions}>
                    <ActionButton
                      label={t.riders.viewDetails}
                      tone="ghost"
                      onPress={() => openDetail(rider.userId)}
                    />
                    {hasDues ? (
                      <ActionButton
                        label={t.riders.recordDeposited(formatRupees(rider.duesPaise))}
                        tone="good"
                        onPress={() => setConfirmId(rider.userId)}
                      />
                    ) : null}
                    {hasEarnings ? (
                      <ActionButton
                        label={`Pay earnings (${formatRupees(rider.earningsPaise)})`}
                        tone="accent"
                        onPress={() => {
                          setEarningsDraft(p => ({ ...p, [rider.userId]: (rider.earningsPaise / 100).toFixed(2) }));
                          setPayEarningsId(rider.userId);
                        }}
                      />
                    ) : null}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <RiderDetailModal
        visible={detailId != null}
        loading={detailLoading}
        error={detailError}
        detail={detail}
        onClose={closeDetail}
      />
    </View>
  );
}

function RiderDetailModal({
  visible,
  loading,
  error,
  detail,
  onClose,
}: {
  visible: boolean;
  loading: boolean;
  error: string | null;
  detail: RiderDetail | null;
  onClose: () => void;
}) {
  const { t } = useLang();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>
                {detail?.name || t.riders.riderDefault}
                {detail?.shortId ? ` · ${detail.shortId}` : ''}
              </Text>
              <Text style={styles.modalSub}>{t.riders.detailSub}</Text>
            </View>
            <Pressable onPress={onClose} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>✕</Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.modalLoading}>
              <ActivityIndicator color={theme.color.accent} />
            </View>
          ) : error ? (
            <View style={styles.modalBody}>
              <Text style={styles.error}>{t.riders.detailLoadFailed(error)}</Text>
            </View>
          ) : detail ? (
            <ScrollView contentContainerStyle={styles.modalBody}>
              {/* Header info */}
              <View style={styles.detailHeaderRow}>
                <StatusBadge online={detail.online} />
                {detail.serviceCity ? <Badge label={detail.serviceCity} tone="info" /> : null}
              </View>
              <KvRow label="Phone" value={detail.phone || t.riders.noPhone} />
              {detail.vehicle ? <KvRow label="Vehicle" value={detail.vehicle} /> : null}
              {detail.serviceCity ? <KvRow label={t.riders.serviceCity} value={detail.serviceCity} /> : null}
              <KvRow label="Joined" value={t.riders.joined(formatDate(detail.joinedAt))} />

              {/* Wallet */}
              <Text style={styles.sectionTitle}>{t.riders.walletSection}</Text>
              <View style={styles.statRow}>
                <Stat label={t.riders.earnings} value={formatRupees(detail.earningsPaise)} />
                <Stat label={t.riders.codDues} value={formatRupees(detail.duesPaise)} tone={detail.duesPaise > 0 ? 'warning' : undefined} />
                <Stat label={t.riders.codLimit} value={formatRupees(detail.creditLimitPaise)} />
              </View>

              {/* KYC */}
              <Text style={styles.sectionTitle}>{t.riders.kycSection}</Text>
              {detail.kyc ? (
                <View style={{ gap: theme.space.md }}>
                  <KvRow label={t.riders.kycFullName} value={detail.kyc.fullName} />
                  <KvRow label={t.riders.kycAadhaar} value={detail.kyc.aadhaar} mono />
                  <KvRow label={t.riders.kycPan} value={detail.kyc.pan ?? '—'} mono />
                  <KvRow label={t.riders.kycDl} value={detail.kyc.dlNumber} mono />
                  <KvRow label={t.riders.kycVehicleNumber} value={detail.kyc.vehicleNumber ?? '—'} mono />
                  <KvRow
                    label={t.riders.kycEmergency}
                    value={
                      detail.kyc.emergencyName || detail.kyc.emergencyPhone
                        ? `${detail.kyc.emergencyName ?? '—'}${detail.kyc.emergencyPhone ? ` · ${detail.kyc.emergencyPhone}` : ''}`
                        : '—'
                    }
                  />
                  {detail.kyc.photoUrl ? (
                    <View style={styles.docsBlock}>
                      <Text style={styles.kvLabel}>{t.riders.kycPhoto}</Text>
                      <DocLink url={detail.kyc.photoUrl} label={t.riders.kycViewPhoto} />
                    </View>
                  ) : null}
                  <View style={styles.docsBlock}>
                    <Text style={styles.kvLabel}>{t.riders.kycDocs}</Text>
                    {detail.kyc.docUrls.length === 0 ? (
                      <Text style={styles.kvValue}>{t.riders.kycNoDocs}</Text>
                    ) : (
                      detail.kyc.docUrls.map((url, i) => (
                        <DocLink key={`${url}-${i}`} url={url} label={url} />
                      ))
                    )}
                  </View>
                  <Text style={styles.modalMeta}>{t.riders.kycSubmitted(formatDate(detail.kyc.submittedAt))}</Text>
                </View>
              ) : (
                <View style={styles.noKycBox}>
                  <Text style={styles.noKycTitle}>{t.riders.noKyc}</Text>
                  <Text style={styles.kvValue}>{t.riders.noKycBody}</Text>
                </View>
              )}

              {/* Recent orders */}
              <Text style={styles.sectionTitle}>{t.riders.recentOrdersSection}</Text>
              {detail.recentOrders.length === 0 ? (
                <Text style={styles.kvValue}>{t.riders.noRecentOrders}</Text>
              ) : (
                <View style={styles.ordersBox}>
                  {detail.recentOrders.map(order => (
                    <RecentOrderRow key={order.orderId} order={order} />
                  ))}
                </View>
              )}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function DocLink({ url, label }: { url: string; label: string }) {
  return (
    <Pressable onPress={() => { void Linking.openURL(url); }}>
      <Text style={styles.docLink} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function KvRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, mono && styles.kvMono]} selectable>{value}</Text>
    </View>
  );
}

function RecentOrderRow({ order }: { order: RecentOrder }) {
  return (
    <View style={styles.orderRow}>
      <View style={[styles.orderStatusDot, { backgroundColor: theme.color.info }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.orderRef}>
          #{order.orderRef} · {order.shopName ?? '?'}{order.city ? ` · ${order.city}` : ''}
        </Text>
        <Text style={styles.orderMeta}>
          {formatRupees(order.totalPaise)} · {order.paymentMethod} · {formatDate(order.createdAt)}
        </Text>
      </View>
      <View style={[styles.orderStatusPill, { backgroundColor: theme.color.infoBg }]}>
        <Text style={[styles.orderStatusText, { color: theme.color.info }]}>{order.status}</Text>
      </View>
    </View>
  );
}

function OrderRow({ order }: { order: ActiveOrder }) {
  const statusColor = order.status === 'OUT_FOR_DELIVERY' ? theme.color.good : theme.color.info;
  const statusBg = order.status === 'OUT_FOR_DELIVERY' ? theme.color.goodBg : theme.color.infoBg;
  const statusLabel = order.status === 'OUT_FOR_DELIVERY' ? 'Out for delivery' : 'Assigned';
  return (
    <View style={styles.orderRow}>
      <View style={[styles.orderStatusDot, { backgroundColor: statusColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.orderRef}>#{order.orderRef} · {order.shopName ?? '?'}</Text>
        <Text style={styles.orderMeta}>{formatRupees(order.totalPaise)} · {order.paymentMethod}</Text>
      </View>
      <View style={[styles.orderStatusPill, { backgroundColor: statusBg }]}>
        <Text style={[styles.orderStatusText, { color: statusColor }]}>{statusLabel}</Text>
      </View>
    </View>
  );
}

function StatusBadge({ online }: { online: boolean }) {
  return (
    <View style={[styles.badge, { backgroundColor: online ? theme.color.goodBg : theme.color.surfaceAlt }]}>
      <Text style={[styles.badgeText, { color: online ? theme.color.good : theme.color.textFaint }]}>
        {online ? 'Online' : 'Offline'}
      </Text>
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: 'good' | 'warning' | 'info' | 'critical' }) {
  const bg = tone === 'good' ? theme.color.goodBg : tone === 'critical' ? theme.color.criticalBg : tone === 'info' ? theme.color.infoBg : theme.color.warningBg;
  const fg = tone === 'good' ? theme.color.good : tone === 'critical' ? theme.color.critical : tone === 'info' ? theme.color.info : theme.color.warning;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tone === 'warning' && styles.statValueWarning]}>{value}</Text>
    </View>
  );
}

function ActionButton({ label, tone, onPress, busy }: { label: string; tone: 'good' | 'ghost' | 'accent'; onPress: () => void; busy?: boolean }) {
  const bg = tone === 'good' ? theme.color.good : tone === 'accent' ? theme.color.accent : 'transparent';
  const fg = tone === 'ghost' ? theme.color.text : '#fff';
  return (
    <Pressable style={[styles.actionBtn, { backgroundColor: bg }]} onPress={onPress} disabled={busy}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.actionBtnText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { padding: theme.space.xl, gap: theme.space.lg, paddingBottom: theme.space.xxxl, maxWidth: theme.maxContentWidth },
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

  tabs: { flexDirection: 'row', gap: theme.space.sm },
  tab: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.borderStrong, backgroundColor: theme.color.surfaceAlt },
  tabActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  tabText: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  tabTextActive: { color: '#fff' },

  list: { gap: theme.space.lg },
  card: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, padding: theme.space.lg, gap: theme.space.md, ...theme.shadow.card },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  openDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, flexWrap: 'wrap' },
  cardName: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  cardMeta: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space.xs },
  cardServiceCity: { fontSize: theme.font.small, color: theme.color.info, marginTop: 2, fontWeight: '600' },

  statRow: { flexDirection: 'row', gap: theme.space.xl, flexWrap: 'wrap', paddingVertical: theme.space.sm, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.color.border },
  stat: { gap: 2 },
  statLabel: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  statValue: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  statValueWarning: { color: theme.color.warning },

  ordersBox: { gap: theme.space.sm, padding: theme.space.md, backgroundColor: theme.color.surfaceAlt, borderRadius: theme.radius.md },
  ordersTitle: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  orderStatusDot: { width: 8, height: 8, borderRadius: 4 },
  orderRef: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  orderMeta: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  orderStatusPill: { paddingVertical: 2, paddingHorizontal: theme.space.sm, borderRadius: theme.radius.pill },
  orderStatusText: { fontSize: theme.font.tiny, fontWeight: '700' },

  actions: { flexDirection: 'row', gap: theme.space.sm, flexWrap: 'wrap', alignItems: 'center' },
  actionBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', minWidth: 96 },
  actionBtnText: { fontWeight: '700', fontSize: theme.font.small },
  confirmBox: { gap: theme.space.md, padding: theme.space.md, borderRadius: theme.radius.md, backgroundColor: theme.color.warningBg },
  confirmText: { fontSize: theme.font.body, color: theme.color.text, lineHeight: 21 },
  payBox: { gap: theme.space.md, padding: theme.space.md, borderRadius: theme.radius.md, backgroundColor: theme.color.infoBg },
  payRow: { flexDirection: 'row', gap: theme.space.sm, alignItems: 'center', flexWrap: 'wrap' },
  payInput: {
    minWidth: 120, borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md,
    padding: theme.space.sm, fontSize: theme.font.body, color: theme.color.text, backgroundColor: theme.color.surface,
  },

  badge: { paddingVertical: 3, paddingHorizontal: theme.space.sm, borderRadius: theme.radius.pill },
  badgeText: { fontSize: theme.font.tiny, fontWeight: '700' },

  empty: { alignItems: 'center', padding: theme.space.xxxl, backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, borderStyle: 'dashed', gap: theme.space.xs },
  emptyTitle: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  emptyBody: { fontSize: theme.font.body, color: theme.color.textMuted },
  error: { color: theme.color.critical, fontSize: theme.font.body },
  banner: { backgroundColor: theme.color.primary, paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl },
  bannerText: { color: '#fff', fontWeight: '600', fontSize: theme.font.small },
  notice: { maxWidth: 420, padding: theme.space.xl, borderRadius: theme.radius.lg, backgroundColor: theme.color.criticalBg, borderWidth: 1, borderColor: '#FCA5A5', gap: theme.space.sm },
  noticeTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.critical },
  noticeBody: { fontSize: theme.font.body, color: theme.color.text, lineHeight: 21 },

  // Rider detail modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: theme.space.lg },
  modalCard: { width: '100%', maxWidth: 520, maxHeight: '85%', backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, overflow: 'hidden' },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.space.sm, padding: theme.space.lg, backgroundColor: theme.color.primary },
  modalTitle: { color: '#fff', fontWeight: '800', fontSize: theme.font.h3 },
  modalSub: { color: theme.color.sidebarText, fontSize: theme.font.tiny, marginTop: 2 },
  modalClose: { width: 32, height: 32, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  modalCloseText: { color: '#fff', fontSize: theme.font.body, fontWeight: '700' },
  modalLoading: { padding: theme.space.xxxl, alignItems: 'center' },
  modalBody: { padding: theme.space.lg, gap: theme.space.md },
  modalMeta: { fontSize: theme.font.small, color: theme.color.textFaint, marginTop: theme.space.xs },
  detailHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, flexWrap: 'wrap' },
  sectionTitle: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.text, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: theme.space.sm },
  kvRow: { gap: 2 },
  kvLabel: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  kvValue: { fontSize: theme.font.body, color: theme.color.text },
  kvMono: { fontFamily: 'monospace' },
  docsBlock: { gap: theme.space.xs },
  docLink: { fontSize: theme.font.small, color: theme.color.accent },
  noKycBox: { padding: theme.space.md, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt, borderWidth: 1, borderColor: theme.color.border, borderStyle: 'dashed', gap: theme.space.xs },
  noKycTitle: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.textMuted },
});
