import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '@passwaala/api-client';
import { api } from '../api';
import { theme } from '../theme';
import { useLang } from '../i18n/LanguageContext';

type AdminCustomer = Awaited<ReturnType<typeof api.adminListCustomers>>[number];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function CustomersScreen() {
  const { t } = useLang();
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const data = await api.adminListCustomers();
      setCustomers(data);
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

  if (loading && customers.length === 0) {
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

  // Client-side filter by name / phone / shortId (the backend also accepts a
  // `q` param, but with a 100-row cap a local filter is instant + offline).
  const q = search.trim().toLowerCase();
  const filtered = q
    ? customers.filter(c =>
        (c.name ?? '').toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q) ||
        (c.shortId ?? '').toLowerCase().includes(q)
      )
    : customers;

  return (
    <View style={styles.wrap}>
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View style={styles.pageHeader}>
          <View>
            <Text style={styles.h1}>{t.nav.customers}</Text>
            <Text style={styles.sub}>{customers.length} total</Text>
          </View>
        </View>

        {/* Search */}
        <View style={styles.filterBar}>
          <TextInput
            style={styles.filterInput}
            placeholder="Search by name, phone, ID…"
            placeholderTextColor={theme.color.textFaint}
            value={search}
            onChangeText={setSearch}
            clearButtonMode="while-editing"
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {filtered.length === 0 && !error ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{q ? 'No matches' : 'No customers'}</Text>
            <Text style={styles.emptyBody}>
              {q ? 'Try a different search.' : 'Customers appear here once they sign up.'}
            </Text>
          </View>
        ) : null}

        <View style={styles.list}>
          {filtered.map((c) => (
            <View key={c.userId} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardName}>{c.name || 'Customer'}</Text>
                    {c.shortId ? <Badge label={c.shortId} tone="info" /> : null}
                  </View>
                  <Text style={styles.cardMeta}>
                    {c.phone || 'No phone'} · Joined {formatDate(c.joinedAt)}
                  </Text>
                </View>
              </View>

              <View style={styles.statRow}>
                <Stat label="Coins" value={String(c.coinBalance)} />
                <Stat label="Total orders" value={String(c.totalOrders)} />
                <Stat label="Delivered" value={String(c.deliveredOrders)} />
                {c.loginPin ? <Stat label="Login PIN" value={c.loginPin} /> : null}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: 'info' }) {
  const bg = tone === 'info' ? theme.color.infoBg : theme.color.surfaceAlt;
  const fg = tone === 'info' ? theme.color.info : theme.color.textFaint;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} selectable>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { padding: theme.space.xl, gap: theme.space.lg, paddingBottom: theme.space.xxxl, maxWidth: theme.maxContentWidth },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },

  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  h1: { fontSize: theme.font.h1, fontWeight: '800', color: theme.color.text },
  sub: { fontSize: theme.font.body, color: theme.color.textMuted, marginTop: 2 },

  filterBar: { flexDirection: 'row', gap: theme.space.sm, alignItems: 'center' },
  filterInput: {
    flex: 1,
    borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md,
    padding: theme.space.md, fontSize: theme.font.body, color: theme.color.text,
    backgroundColor: theme.color.surfaceAlt,
  },

  list: { gap: theme.space.lg },
  card: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, padding: theme.space.lg, gap: theme.space.md, ...theme.shadow.card },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, flexWrap: 'wrap' },
  cardName: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  cardMeta: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space.xs },

  statRow: { flexDirection: 'row', gap: theme.space.xl, flexWrap: 'wrap', paddingVertical: theme.space.sm, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.color.border },
  stat: { gap: 2 },
  statLabel: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  statValue: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },

  badge: { paddingVertical: 3, paddingHorizontal: theme.space.sm, borderRadius: theme.radius.pill },
  badgeText: { fontSize: theme.font.tiny, fontWeight: '700' },

  empty: { alignItems: 'center', padding: theme.space.xxxl, backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, borderStyle: 'dashed', gap: theme.space.xs },
  emptyTitle: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  emptyBody: { fontSize: theme.font.body, color: theme.color.textMuted },
  error: { color: theme.color.critical, fontSize: theme.font.body },
  notice: { maxWidth: 420, padding: theme.space.xl, borderRadius: theme.radius.lg, backgroundColor: theme.color.criticalBg, borderWidth: 1, borderColor: '#FCA5A5', gap: theme.space.sm },
  noticeTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.critical },
  noticeBody: { fontSize: theme.font.body, color: theme.color.text, lineHeight: 21 },
});
