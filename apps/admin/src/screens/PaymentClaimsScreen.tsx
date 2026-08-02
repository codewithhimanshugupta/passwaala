import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '@passwaala/api-client';
import { api } from '../api';
import { formatRupees, theme } from '../theme';
import { useLang } from '../i18n/LanguageContext';

interface PaymentClaim {
  id: string;
  entityType: 'SHOP' | 'RIDER';
  shopId?: string;
  shopName?: string;
  riderUserId?: string;
  riderName?: string | null;
  riderPhone?: string | null;
  amountPaise: number;
  claimedAt: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

/**
 * PaymentClaimsScreen — shows all pending payment claims filed by shopkeepers
 * (dues deposits) and riders (COD cash deposits). Admin confirms receipt to
 * decrement the payer's balance by the exact claimed amount.
 */
export function PaymentClaimsScreen() {
  const { t } = useLang();
  const [claims, setClaims] = useState<PaymentClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const data = (await api.adminListPaymentClaims()) as PaymentClaim[];
      setClaims(data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  function flash(msg: string) {
    setBanner(msg);
    setTimeout(() => setBanner(null), 3500);
  }

  async function approve(claim: PaymentClaim) {
    setBusyId(claim.id);
    try {
      await api.adminApprovePaymentClaim(claim.id);
      const who = claim.entityType === 'SHOP'
        ? (claim.shopName ?? t.paymentClaims.shopDefault)
        : (claim.riderName ?? claim.riderPhone ?? t.paymentClaims.riderDefault);
      flash(t.paymentClaims.confirmedFlash(formatRupees(claim.amountPaise), who));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) flash(t.paymentClaims.denied);
      else flash(t.paymentClaims.failed((e as Error).message));
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
          <Text style={styles.noticeTitle}>{t.paymentClaims.accessDenied}</Text>
          <Text style={styles.noticeBody}>{t.paymentClaims.accessDeniedBody}</Text>
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
            <Text style={styles.h1}>{t.paymentClaims.title}</Text>
            <Text style={styles.sub}>
              {claims.length === 0
                ? t.paymentClaims.noPending
                : t.paymentClaims.pendingCount(claims.length)}
            </Text>
          </View>
          <Pressable style={styles.refresh} onPress={load}>
            <Text style={styles.refreshText}>{t.common.refresh}</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {claims.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t.paymentClaims.allClear}</Text>
            <Text style={styles.emptyBody}>{t.paymentClaims.allClearBody}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {claims.map((claim) => {
              const busy = busyId === claim.id;
              const isShop = claim.entityType === 'SHOP';
              const who = isShop
                ? (claim.shopName ?? t.paymentClaims.unknownShop)
                : (claim.riderName ?? claim.riderPhone ?? t.paymentClaims.unknownRider);
              const type = isShop ? t.paymentClaims.shopDues : t.paymentClaims.riderCodDeposit;
              return (
                <View key={claim.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <View style={styles.typeTag}>
                      <Text style={[styles.typeText, isShop ? styles.typeShop : styles.typeRider]}>
                        {isShop ? t.paymentClaims.shopTag : t.paymentClaims.riderTag}
                      </Text>
                    </View>
                    <Text style={styles.cardDate}>{formatDate(claim.claimedAt)}</Text>
                  </View>

                  <Text style={styles.cardWho}>{who}</Text>
                  <Text style={styles.cardType}>{type}</Text>

                  <View style={styles.amountRow}>
                    <Text style={styles.amountLabel}>{t.paymentClaims.claimedAmount}</Text>
                    <Text style={styles.amountValue}>{formatRupees(claim.amountPaise)}</Text>
                  </View>

                  <Pressable
                    style={[styles.confirmBtn, busy && styles.confirmBtnBusy]}
                    onPress={() => approve(claim)}
                    disabled={busy}
                  >
                    {busy
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.confirmBtnText}>{t.paymentClaims.confirmReceived(formatRupees(claim.amountPaise))}</Text>}
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { padding: theme.space.xl, gap: theme.space.lg, maxWidth: theme.maxContentWidth },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  h1: { fontSize: theme.font.h1, fontWeight: '800', color: theme.color.text },
  sub: { fontSize: theme.font.body, color: theme.color.textMuted, marginTop: 2 },
  refresh: {
    paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.borderStrong,
    backgroundColor: theme.color.surface,
  },
  refreshText: { color: theme.color.text, fontWeight: '600', fontSize: theme.font.small },
  list: { gap: theme.space.lg },
  card: {
    backgroundColor: theme.color.surface, borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: theme.color.border, padding: theme.space.lg,
    gap: theme.space.sm, ...theme.shadow.card,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  typeTag: { alignSelf: 'flex-start' },
  typeText: { fontSize: theme.font.tiny, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  typeShop: { color: theme.color.primary },
  typeRider: { color: theme.color.accent },
  cardDate: { fontSize: theme.font.tiny, color: theme.color.textFaint },
  cardWho: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  cardType: { fontSize: theme.font.small, color: theme.color.textMuted },
  amountRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: theme.space.sm, borderTopWidth: 1, borderBottomWidth: 1,
    borderColor: theme.color.border, marginVertical: theme.space.xs,
  },
  amountLabel: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  amountValue: { fontSize: theme.font.h3, fontWeight: '900', color: theme.color.text },
  confirmBtn: {
    backgroundColor: theme.color.good, borderRadius: theme.radius.md,
    paddingVertical: theme.space.md, alignItems: 'center', justifyContent: 'center',
  },
  confirmBtnBusy: { opacity: 0.6 },
  confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.body },
  empty: {
    alignItems: 'center', padding: theme.space.xxxl, backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border,
    borderStyle: 'dashed', gap: theme.space.xs,
  },
  emptyTitle: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  emptyBody: { fontSize: theme.font.body, color: theme.color.textMuted, textAlign: 'center' },
  error: { color: theme.color.critical, fontSize: theme.font.body },
  banner: { backgroundColor: theme.color.primary, paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl },
  bannerText: { color: '#fff', fontWeight: '600', fontSize: theme.font.small },
  notice: {
    maxWidth: 420, padding: theme.space.xl, borderRadius: theme.radius.lg,
    backgroundColor: theme.color.criticalBg, borderWidth: 1, borderColor: '#FCA5A5', gap: theme.space.sm,
  },
  noticeTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.critical },
  noticeBody: { fontSize: theme.font.body, color: theme.color.text, lineHeight: 21 },
});
