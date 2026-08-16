import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { getCurrentCoords } from '../geo';
import { getPrefetchedRiderMe } from '../riderPrefetch';
import { theme } from '../theme';
import { Banner, ErrorText, Screen } from '../ui';
import { LanguagePicker } from '../components/LanguagePicker';
import { useLang } from '../i18n/LanguageContext';
import type { RiderMe } from '../types';

/**
 * HomeScreen — the rider's availability control. A big ONLINE/OFFLINE toggle
 * drives availability (riderSetOnline, best-effort with GPS coords) and a live
 * status banner. Earnings, COD dues, and system alerts each live on their own
 * tab now. `online` is lifted to App so the Jobs tab can react to it.
 */
export function HomeScreen({
  online,
  onOnlineChange,
}: {
  online: boolean;
  onOnlineChange: (online: boolean) => void;
}) {
  const [loading, setLoading] = useState(!getPrefetchedRiderMe());
  const [toggling, setToggling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLang();

  const load = useCallback(async () => {
    try {
      const data: RiderMe = await api.riderMe();
      onOnlineChange(data.online);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onOnlineChange]);

  useEffect(() => {
    load();
  }, [load]);

  /** Read the current GPS coords (best-effort) so the backend can match jobs. */
  async function getCoords(): Promise<{ latitude?: number; longitude?: number }> {
    const c = await getCurrentCoords();
    return c ? { latitude: c.lat, longitude: c.lng } : {};
  }

  async function toggle() {
    const prev = online;
    const next = !online;
    setToggling(true);
    setError(null);
    // Optimistic: flip the availability state immediately so the big toggle
    // reacts instantly (even while we capture GPS + hit the server). If the
    // server rejects it (e.g. a dues-cap block on going online), roll back to
    // the previous state and surface the message.
    onOnlineChange(next);
    try {
      // Only bother capturing location when going online.
      const coords = next ? await getCoords() : {};
      const res = await api.riderSetOnline(next, coords.latitude, coords.longitude);
      onOnlineChange(res.online); // reconcile with the server's truth
    } catch (e) {
      onOnlineChange(prev); // rollback
      setError((e as Error).message);
    } finally {
      setToggling(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.color.accent} size="large" />
      </View>
    );
  }

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={theme.color.accent}
        />
      }
    >
      <LanguagePicker compact />

      <Pressable
        onPress={toggle}
        disabled={toggling}
        style={[styles.toggle, online ? styles.toggleOnline : styles.toggleOffline, toggling && styles.dim]}
      >
        <View style={[styles.statusDot, { backgroundColor: online ? '#8DEBB6' : theme.color.textFaint }]} />
        <Text style={styles.toggleStatus}>{online ? t.home.online : t.home.offline}</Text>
        <Text style={styles.toggleHint}>
          {online ? t.home.tapOffline : t.home.tapOnline}
        </Text>
      </Pressable>

      {online ? (
        <Banner
          tone="success"
          title={t.home.liveTitle}
          message={t.home.liveMessage}
        />
      ) : (
        <Banner
          tone="info"
          title={t.home.goOnlineTitle}
          message={t.home.goOnlineMessage}
        />
      )}

      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.bg },
  toggle: {
    borderRadius: theme.radius.xl,
    paddingVertical: theme.space.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space.xs,
    ...theme.shadow.md,
  },
  toggleOnline: { backgroundColor: theme.color.success },
  toggleOffline: { backgroundColor: theme.color.text },
  dim: { opacity: 0.7 },
  statusDot: { width: 14, height: 14, borderRadius: 7, marginBottom: theme.space.xs },
  toggleStatus: { color: theme.color.white, fontSize: theme.font.h1, fontWeight: '900', letterSpacing: 0.5 },
  toggleHint: { color: theme.color.white, fontSize: theme.font.small, opacity: 0.85 },
});
