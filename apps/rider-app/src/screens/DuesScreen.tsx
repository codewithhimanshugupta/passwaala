import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { buildUpiDeepLink, UPI_APPS, toIntentLink } from '@passwaala/shared';
import { api } from '../api';
import { getPrefetchedRiderMe } from '../riderPrefetch';
import { formatRupees, theme } from '../theme';
import { Banner, Button, Card, ErrorText, Screen } from '../ui';
import { UpiQr } from '../components/UpiQr';
import { useLang } from '../i18n/LanguageContext';
import type { RiderMe } from '../types';

/**
 * DuesScreen — the rider's COD cash-to-deposit, a one-tap UPI deposit to
 * NearBaz's collection VPA (+ QR fallback), and the per-distance delivery-fee
 * reference. Split out of the old crowded Home screen onto its own tab.
 */
export function DuesScreen() {
  const { t } = useLang();
  const prefetchedMe = getPrefetchedRiderMe();
  const [me, setMe] = useState<RiderMe | null>(prefetchedMe);
  const [loading, setLoading] = useState(!prefetchedMe);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTiers, setShowTiers] = useState(false);
  const [showUpiPicker, setShowUpiPicker] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.riderMe();
      setMe(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openDuesUpi(link: string, amountPaise: number) {
    if (Platform.OS === 'web') {
      setShowUpiPicker(true);
    } else {
      void Linking.openURL(link);
      void api.claimRiderPayment(amountPaise).catch(() => undefined);
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={theme.color.accent} size="large" /></View>;
  }

  const dues = me?.duesPaise ?? 0;
  const duesLimit = me?.creditLimitPaise ?? 50000;
  const atCap = dues >= duesLimit;
  const duesUpiLink =
    dues > 0 && me?.collectionUpi
      ? buildUpiDeepLink(me.collectionUpi.vpa, me.collectionUpi.name, dues, 'COD dues')
      : null;

  // Live per-km delivery fee tiers, admin-configured for the rider's city.
  // Each tier is { maxKm, feePaise }; rendered as bands relative to the prior
  // tier's ceiling. A final open-ended tier (maxKm ≥ 999) shows as "X+ km".
  const rawTiers = me?.deliveryTiers ?? [];
  const tierRows = rawTiers.map((tier, i) => {
    const prevMax = i === 0 ? 0 : rawTiers[i - 1].maxKm;
    const isLast = i === rawTiers.length - 1;
    const openEnded = tier.maxKm >= 999;
    let range: string;
    if (isLast && openEnded) range = `${prevMax}+ km`;
    else if (i === 0) range = `Up to ${tier.maxKm} km`;
    else range = `${prevMax} – ${tier.maxKm} km`;
    return { range, fee: formatRupees(tier.feePaise) };
  });

  return (
  <>
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={theme.color.accent}
        />
      }
    >
      {/* COD dues — cash the rider has collected and owes onward, with a cap. */}
      {dues > 0 ? (
        <Banner
          tone={atCap ? 'danger' : 'warning'}
          title={t.home.codToDeposit(formatRupees(dues), formatRupees(duesLimit))}
          message={atCap ? t.home.codAtCap : t.home.codBelowCap}
        />
      ) : (
        <Banner tone="success" title={t.dues.clearTitle} message={t.dues.clearMessage} />
      )}

      {/* Pay now — deposit dues directly to NearBaz's collection UPI. */}
      {dues > 0 && duesUpiLink ? (
        <Card>
          <Text style={styles.payTitle}>{t.home.payDuesTitle}</Text>
          <Text style={styles.paySub}>
            {t.home.payDuesSub(formatRupees(dues), me?.collectionUpi?.name ?? t.home.passwala)}
          </Text>
          <Button label={t.home.payNow(formatRupees(dues))} onPress={() => openDuesUpi(duesUpiLink, dues)} />
          <View style={styles.qrWrap}>
            <UpiQr link={duesUpiLink} size={180} />
            <Text style={styles.qrHint}>{t.home.scanUpi}</Text>
          </View>
        </Card>
      ) : null}

      {/* Delivery fee tiers — what the rider earns per km band */}
      <Card>
        <Pressable onPress={() => setShowTiers(v => !v)} style={styles.tiersHeader}>
          <Text style={styles.tiersTitleText}>{t.dues.feeByDistance}</Text>
          <Text style={styles.tiersChevron}>{showTiers ? '▲' : '▼'}</Text>
        </Pressable>
        {showTiers ? (
          <View style={styles.tiersTable}>
            {tierRows.length > 0 ? (
              tierRows.map((row, i) => (
                <View key={`${row.range}-${i}`} style={styles.tiersRow}>
                  <Text style={styles.tiersRange}>{row.range}</Text>
                  <Text style={styles.tiersFee}>{row.fee}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.tiersRange}>{t.dues.tiersNotSet}</Text>
            )}
            <Text style={styles.tiersNote}>{t.dues.feeNote}</Text>
          </View>
        ) : null}
      </Card>

      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>

    {/* UPI app picker — web only */}
    <Modal visible={showUpiPicker} transparent animationType="fade" onRequestClose={() => setShowUpiPicker(false)}>
      <View style={styles.pickerBackdrop}>
        <View style={styles.pickerCard}>
          <Text style={styles.pickerTitle}>Pay with UPI</Text>
          <Text style={styles.pickerSub}>{formatRupees(dues)}</Text>
          {UPI_APPS.map(({ label, pkg, iconBg, iconText }) => (
            <Pressable
              key={pkg}
              style={styles.upiAppBtn}
              onPress={() => {
                setShowUpiPicker(false);
                if (duesUpiLink) {
                  window.location.href = toIntentLink(duesUpiLink, pkg);
                  void api.claimRiderPayment(dues).catch(() => undefined);
                }
              }}
            >
              <View style={[styles.upiAppIcon, { backgroundColor: iconBg }]}>
                <Text style={styles.upiAppIconText}>{iconText}</Text>
              </View>
              <Text style={styles.upiAppBtnText}>{label}</Text>
            </Pressable>
          ))}
          <Pressable
            style={[styles.upiAppBtn, styles.upiAppBtnOutline]}
            onPress={() => {
              setShowUpiPicker(false);
              if (duesUpiLink) {
                window.location.href = duesUpiLink;
                void api.claimRiderPayment(dues).catch(() => undefined);
              }
            }}
          >
            <Text style={[styles.upiAppBtnText, styles.upiAppBtnOutlineText]}>Other UPI app</Text>
          </Pressable>
          <Pressable onPress={() => setShowUpiPicker(false)} style={styles.pickerCancel}>
            <Text style={styles.pickerCancelText}>{t.common.cancel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.bg },
  payTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  paySub: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2, marginBottom: theme.space.md },
  qrWrap: { alignItems: 'center', marginTop: theme.space.md, gap: theme.space.sm },
  qrHint: { fontSize: theme.font.tiny, color: theme.color.textMuted, textAlign: 'center' },
  tiersHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tiersTitleText: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.text },
  tiersChevron: { fontSize: theme.font.tiny, color: theme.color.textFaint },
  tiersTable: { marginTop: theme.space.md, gap: theme.space.xs },
  tiersRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: theme.space.xs, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  tiersRange: { fontSize: theme.font.small, color: theme.color.textMuted },
  tiersFee: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.text },
  tiersNote: { fontSize: theme.font.tiny, color: theme.color.textFaint, marginTop: theme.space.sm, lineHeight: 16 },

  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },
  pickerCard: {
    backgroundColor: theme.color.bg,
    borderRadius: theme.radius.lg,
    padding: theme.space.xl,
    gap: theme.space.sm,
    width: '100%',
    maxWidth: 360,
    alignItems: 'stretch',
  },
  pickerTitle: { fontSize: theme.font.h2, fontWeight: '700', color: theme.color.text, textAlign: 'center' },
  pickerSub: { fontSize: theme.font.body, color: theme.color.textMuted, textAlign: 'center', marginBottom: theme.space.xs },
  upiAppBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
  },
  upiAppIcon: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  upiAppIconText: { color: '#fff', fontWeight: '800', fontSize: theme.font.small },
  upiAppBtnText: { color: theme.color.text, fontWeight: '700', fontSize: theme.font.body },
  upiAppBtnOutline: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: theme.color.border },
  upiAppBtnOutlineText: { color: theme.color.textMuted },
  pickerCancel: { paddingVertical: theme.space.sm, alignItems: 'center' },
  pickerCancelText: { color: theme.color.textMuted, fontSize: theme.font.body },
});
