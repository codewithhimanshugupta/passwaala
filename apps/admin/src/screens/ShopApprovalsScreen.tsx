import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '@nearbaz/api-client';
import { api } from '../api';
import { theme } from '../theme';
import { useLang } from '../i18n/LanguageContext';

/** Shape returned by GET /admin/shops/pending (select in admin.service). */
interface PendingShop {
  id: string;
  name: string;
  shopCategory: string;
  storefrontPhotoUrl: string | null;
  createdAt: string;
}

/** Shape returned by GET /admin/shops/:id/kyc (ShopKyc row). */
interface ShopKyc {
  id: string;
  shopId: string;
  aadhaarPan: string;
  gstOrLicence: string;
  fssai: string | null;
  bankProofUrl: string;
  docUrls: unknown;
  createdAt: string;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function docUrlList(docUrls: unknown): string[] {
  if (Array.isArray(docUrls)) return docUrls.map((u) => String(u));
  return [];
}

/**
 * ShopApprovalsScreen — lists PENDING_REVIEW shops as cards. Each card can:
 *  - View KYC (opens a modal with Aadhaar/PAN, GST/licence, FSSAI, doc URLs)
 *  - Approve (POST /approve) — shop goes live
 *  - Reject (POST /reject with a required reason)
 * The list refreshes after any action.
 */
export function ShopApprovalsScreen() {
  const { t } = useLang();
  const [shops, setShops] = useState<PendingShop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Per-card UI state.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  // KYC modal state.
  const [kyc, setKyc] = useState<ShopKyc | null>(null);
  const [kycShop, setKycShop] = useState<PendingShop | null>(null);
  const [kycLoading, setKycLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const data = (await api.adminPendingShops()) as PendingShop[];
      setShops(data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  function flash(msg: string) {
    setBanner(msg);
    setTimeout(() => setBanner(null), 3500);
  }

  async function viewKyc(shop: PendingShop) {
    setKycShop(shop);
    setKyc(null);
    setKycLoading(true);
    try {
      const data = (await api.adminShopKyc(shop.id)) as ShopKyc;
      setKyc(data);
    } catch (e) {
      flash(t.approvals.kycLoadFailed((e as Error).message));
      setKycShop(null);
    } finally {
      setKycLoading(false);
    }
  }

  async function approve(shop: PendingShop) {
    setBusyId(shop.id);
    // Optimistic: drop the shop from the pending list immediately; restore it
    // (and surface the error) if the server rejects the approval.
    const prev = shops;
    setShops((list) => list.filter((s) => s.id !== shop.id));
    try {
      await api.adminApproveShop(shop.id);
      flash(t.approvals.approvedFlash(shop.name));
    } catch (e) {
      setShops(prev); // rollback
      flash(t.approvals.approveFailed((e as Error).message));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmReject(shop: PendingShop) {
    if (!reason.trim()) {
      flash(t.approvals.reasonRequired);
      return;
    }
    const trimmedReason = reason.trim();
    setBusyId(shop.id);
    // Optimistic: drop the shop from the pending list and close the reject box
    // immediately; restore everything if the server call fails.
    const prev = shops;
    setShops((list) => list.filter((s) => s.id !== shop.id));
    setRejectingId(null);
    setReason('');
    try {
      await api.adminRejectShop(shop.id, trimmedReason);
      flash(t.approvals.rejectedFlash(shop.name));
    } catch (e) {
      setShops(prev); // rollback
      flash(t.approvals.rejectFailed((e as Error).message));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
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
          <Text style={styles.noticeBody}>
            {t.common.notAdminBody}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {banner ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{banner}</Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.h1}>{t.approvals.title}</Text>
            <Text style={styles.sub}>
              {t.approvals.subtitle(shops.length)}
            </Text>
          </View>
          <Pressable style={styles.refresh} onPress={load}>
            <Text style={styles.refreshText}>{t.common.refresh}</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {shops.length === 0 && !error ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t.approvals.allCaughtUp}</Text>
            <Text style={styles.emptyBody}>{t.approvals.nonePending}</Text>
          </View>
        ) : null}

        <View style={styles.list}>
          {shops.map((shop) => {
            const busy = busyId === shop.id;
            const rejecting = rejectingId === shop.id;
            return (
              <View key={shop.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.cardTitleRow}>
                      <Text style={styles.cardName}>{shop.name}</Text>
                      <Badge label={t.approvals.pendingReview} tone="warning" />
                    </View>
                    <Text style={styles.cardMeta}>
                      {shop.shopCategory} · {t.approvals.submitted(formatDate(shop.createdAt))}
                    </Text>
                    <Text style={styles.cardId}>{t.approvals.idLabel(shop.id)}</Text>
                  </View>
                </View>

                {rejecting ? (
                  <View style={styles.rejectBox}>
                    <Text style={styles.label}>{t.approvals.rejectionReason}</Text>
                    <TextInput
                      style={styles.reasonInput}
                      placeholder={t.approvals.rejectPlaceholder}
                      placeholderTextColor={theme.color.textFaint}
                      value={reason}
                      onChangeText={setReason}
                      multiline
                      autoFocus
                    />
                    <View style={styles.actions}>
                      <ActionButton
                        label={t.approvals.confirmReject}
                        tone="critical"
                        busy={busy}
                        onPress={() => confirmReject(shop)}
                      />
                      <ActionButton
                        label={t.common.cancel}
                        tone="ghost"
                        onPress={() => {
                          setRejectingId(null);
                          setReason('');
                        }}
                      />
                    </View>
                  </View>
                ) : (
                  <View style={styles.actions}>
                    <ActionButton
                      label={t.approvals.viewKyc}
                      tone="secondary"
                      onPress={() => viewKyc(shop)}
                    />
                    <ActionButton
                      label={t.approvals.approve}
                      tone="good"
                      busy={busy}
                      onPress={() => approve(shop)}
                    />
                    <ActionButton
                      label={t.approvals.reject}
                      tone="critical"
                      onPress={() => {
                        setReason('');
                        setRejectingId(shop.id);
                      }}
                    />
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <KycModal
        shop={kycShop}
        kyc={kyc}
        loading={kycLoading}
        onClose={() => {
          setKycShop(null);
          setKyc(null);
        }}
      />
    </View>
  );
}

function KycModal({
  shop,
  kyc,
  loading,
  onClose,
}: {
  shop: PendingShop | null;
  kyc: ShopKyc | null;
  loading: boolean;
  onClose: () => void;
}) {
  const { t } = useLang();
  const visible = !!shop;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHead}>
            <View>
              <Text style={styles.modalTitle}>{t.approvals.kycTitle(shop?.name ?? '')}</Text>
              <Text style={styles.modalSub}>{t.approvals.kycSub}</Text>
            </View>
            <Pressable onPress={onClose} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>✕</Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.modalLoading}>
              <ActivityIndicator color={theme.color.accent} />
            </View>
          ) : kyc ? (
            <ScrollView contentContainerStyle={styles.modalBody}>
              <KvRow label={t.approvals.kycAadhaarPan} value={kyc.aadhaarPan} mono />
              <KvRow label={t.approvals.kycGstLicence} value={kyc.gstOrLicence} mono />
              <KvRow label={t.approvals.kycFssai} value={kyc.fssai ?? '—'} mono />
              <KvRow label={t.approvals.kycBankProof} value={kyc.bankProofUrl} link />
              <View style={styles.docsBlock}>
                <Text style={styles.kvLabel}>{t.approvals.kycDocUrls}</Text>
                {docUrlList(kyc.docUrls).length === 0 ? (
                  <Text style={styles.kvValue}>{t.approvals.kycNoDocs}</Text>
                ) : (
                  docUrlList(kyc.docUrls).map((url, i) => (
                    <Text key={`${url}-${i}`} style={styles.docLink}>
                      {url}
                    </Text>
                  ))
                )}
              </View>
              <Text style={styles.modalMeta}>{t.approvals.kycSubmitted(formatDate(kyc.createdAt))}</Text>
            </ScrollView>
          ) : (
            <Text style={styles.kvValue}>{t.approvals.kycNoData}</Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

function KvRow({
  label,
  value,
  mono,
  link,
}: {
  label: string;
  value: string;
  mono?: boolean;
  link?: boolean;
}) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text
        style={[styles.kvValue, mono && styles.kvMono, link && styles.kvLink]}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: 'warning' | 'good' | 'info' }) {
  const bg =
    tone === 'good'
      ? theme.color.goodBg
      : tone === 'info'
        ? theme.color.infoBg
        : theme.color.warningBg;
  const fg =
    tone === 'good'
      ? theme.color.good
      : tone === 'info'
        ? theme.color.info
        : theme.color.warning;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

type BtnTone = 'good' | 'critical' | 'secondary' | 'ghost';

function ActionButton({
  label,
  tone,
  onPress,
  busy,
}: {
  label: string;
  tone: BtnTone;
  onPress: () => void;
  busy?: boolean;
}) {
  const isSolid = tone === 'good' || tone === 'critical';
  const bg =
    tone === 'good'
      ? theme.color.good
      : tone === 'critical'
        ? theme.color.critical
        : tone === 'secondary'
          ? theme.color.surface
          : 'transparent';
  const fg = isSolid ? '#fff' : theme.color.text;
  const border = tone === 'secondary' ? theme.color.borderStrong : 'transparent';
  return (
    <Pressable
      style={[
        styles.actionBtn,
        { backgroundColor: bg, borderColor: border, borderWidth: tone === 'secondary' ? 1 : 0 },
      ]}
      onPress={onPress}
      disabled={busy}
    >
      <Text style={[styles.actionBtnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { padding: theme.space.xl, gap: theme.space.lg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space.xl,
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
  list: { gap: theme.space.lg },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.lg,
    gap: theme.space.md,
    ...theme.shadow.card,
  },
  cardHead: { flexDirection: 'row' },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    flexWrap: 'wrap',
  },
  cardName: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  cardMeta: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space.xs },
  cardId: { fontSize: theme.font.tiny, color: theme.color.textFaint, marginTop: 2 },
  actions: { flexDirection: 'row', gap: theme.space.sm, flexWrap: 'wrap' },
  actionBtn: {
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.lg,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 96,
  },
  actionBtnText: { fontWeight: '700', fontSize: theme.font.small },
  rejectBox: {
    gap: theme.space.sm,
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.criticalBg,
  },
  label: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.text },
  reasonInput: {
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    fontSize: theme.font.body,
    color: theme.color.text,
    backgroundColor: theme.color.surface,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  badge: {
    paddingVertical: 3,
    paddingHorizontal: theme.space.sm,
    borderRadius: theme.radius.pill,
  },
  badgeText: { fontSize: theme.font.tiny, fontWeight: '700' },
  empty: {
    alignItems: 'center',
    padding: theme.space.xxxl,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderStyle: 'dashed',
    gap: theme.space.xs,
  },
  emptyTitle: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  emptyBody: { fontSize: theme.font.body, color: theme.color.textMuted },
  error: { color: theme.color.critical, fontSize: theme.font.body },
  banner: {
    backgroundColor: theme.color.primary,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.xl,
  },
  bannerText: { color: '#fff', fontWeight: '600', fontSize: theme.font.small },
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
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '85%',
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
  },
  modalHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.space.lg,
    backgroundColor: theme.color.primary,
  },
  modalTitle: { color: '#fff', fontWeight: '800', fontSize: theme.font.h3 },
  modalSub: { color: theme.color.sidebarText, fontSize: theme.font.tiny, marginTop: 2 },
  modalClose: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  modalCloseText: { color: '#fff', fontSize: theme.font.body, fontWeight: '700' },
  modalLoading: { padding: theme.space.xxxl, alignItems: 'center' },
  modalBody: { padding: theme.space.lg, gap: theme.space.md },
  kvRow: { gap: 2 },
  kvLabel: {
    fontSize: theme.font.tiny,
    fontWeight: '700',
    color: theme.color.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  kvValue: { fontSize: theme.font.body, color: theme.color.text },
  kvMono: { fontFamily: 'monospace' },
  kvLink: { color: theme.color.accent },
  docsBlock: { gap: theme.space.xs },
  docLink: { fontSize: theme.font.small, color: theme.color.accent },
  modalMeta: {
    fontSize: theme.font.small,
    color: theme.color.textFaint,
    marginTop: theme.space.sm,
  },
});
