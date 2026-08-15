import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { buildUpiDeepLink } from '@passwaala/shared';
import { api } from '../api';
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
  const [me, setMe] = useState<RiderMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTiers, setShowTiers] = useState(false);

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
    void Linking.openURL(link);
    void api.claimRiderPayment(amountPaise).catch(() => undefined);
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

  return (
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
            {[
              { range: t.dues.tierUpTo2, fee: '₹25' },
              { range: t.dues.tier2to5, fee: '₹40' },
              { range: t.dues.tier5to8, fee: '₹50' },
              { range: t.dues.tier8to10, fee: '₹70' },
            ].map((row) => (
              <View key={row.range} style={styles.tiersRow}>
                <Text style={styles.tiersRange}>{row.range}</Text>
                <Text style={styles.tiersFee}>{row.fee}</Text>
              </View>
            ))}
            <Text style={styles.tiersNote}>{t.dues.feeNote}</Text>
          </View>
        ) : null}
      </Card>

      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
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
});
