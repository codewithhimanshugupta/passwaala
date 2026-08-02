import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { formatRupees, theme } from '../theme';
import { Card, ErrorText, Screen } from '../ui';
import { useLang } from '../i18n/LanguageContext';
import type { RiderLedgerType, RiderMe } from '../types';

/**
 * EarningsScreen — the rider's earnings at a glance plus a full earnings
 * statement: currently-owed / lifetime-earned / paid-out summary stats and a
 * recent ledger history. Split out of the old crowded Home screen so earnings
 * live on their own tab.
 */
export function EarningsScreen() {
  const { t } = useLang();
  const [me, setMe] = useState<RiderMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={theme.color.accent} size="large" /></View>;
  }

  const ledger = me?.ledger ?? [];

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
      <Card>
        <Text style={styles.earningsLabel}>Currently owed to you</Text>
        <Text style={styles.earningsValue}>{formatRupees(me?.earningsPaise ?? 0)}</Text>
        {me?.vehicle ? <Text style={styles.vehicle}>🛵 {me.vehicle}</Text> : null}
      </Card>

      {/* Lifetime summary — total ever earned and total ever paid out. */}
      <View style={styles.statsRow}>
        <Card style={styles.statCard}>
          <Text style={styles.statLabel}>Lifetime earned</Text>
          <Text style={styles.statValue}>{formatRupees(me?.lifetimeEarnedPaise ?? 0)}</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statLabel}>Paid out</Text>
          <Text style={styles.statValue}>{formatRupees(me?.lifetimePaidOutPaise ?? 0)}</Text>
        </Card>
      </View>

      {/* Earnings statement — recent ledger history. */}
      <Card>
        <Text style={styles.statementTitle}>Statement</Text>
        {ledger.length === 0 ? (
          <Text style={styles.emptyText}>No activity yet.</Text>
        ) : (
          <View style={styles.ledgerList}>
            {ledger.map((row) => {
              const isEarning = row.type === 'DELIVERY_EARNING';
              const sign = row.amountPaise >= 0 ? '+' : '-';
              const amountText = `${sign}${formatRupees(Math.abs(row.amountPaise))}`;
              return (
                <View key={row.id} style={styles.ledgerRow}>
                  <View style={styles.ledgerMain}>
                    <Text style={styles.ledgerLabel}>{ledgerLabel(row.type)}</Text>
                    {row.note ? <Text style={styles.ledgerNote}>{row.note}</Text> : null}
                    <Text style={styles.ledgerDate}>{formatLedgerDate(row.createdAt)}</Text>
                  </View>
                  <Text style={[styles.ledgerAmount, isEarning && styles.ledgerAmountEarning]}>
                    {amountText}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </Card>

      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}

/** Human-readable label for a ledger row type. */
function ledgerLabel(type: RiderLedgerType): string {
  switch (type) {
    case 'DELIVERY_EARNING':
      return 'Delivery earning';
    case 'EARNING_PAYOUT':
      return 'Paid out by PassWaala';
    case 'COD_COLLECTED':
      return 'COD collected';
    case 'COD_DEPOSIT':
      return 'COD deposited';
    default:
      return type;
  }
}

/** Format a ledger timestamp as e.g. "2 Aug, 04:30 pm". */
function formatLedgerDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.bg },
  earningsLabel: {
    fontSize: theme.font.tiny,
    fontWeight: '800',
    color: theme.color.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  earningsValue: { fontSize: theme.font.display, fontWeight: '900', color: theme.color.text, marginTop: theme.space.xs },
  vehicle: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space.sm },

  statsRow: { flexDirection: 'row', gap: theme.space.md },
  statCard: { flex: 1 },
  statLabel: {
    fontSize: theme.font.tiny,
    fontWeight: '800',
    color: theme.color.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  statValue: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text, marginTop: theme.space.xs },

  statementTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text, marginBottom: theme.space.sm },
  emptyText: { fontSize: theme.font.small, color: theme.color.textMuted },
  ledgerList: { gap: theme.space.xs },
  ledgerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.space.md,
    paddingVertical: theme.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  ledgerMain: { flex: 1, gap: 2 },
  ledgerLabel: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  ledgerNote: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  ledgerDate: { fontSize: theme.font.tiny, color: theme.color.textFaint },
  ledgerAmount: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.text },
  ledgerAmountEarning: { color: theme.color.success },
});
