import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import { Card, Screen } from '../ui';
import { useLang } from '../i18n/LanguageContext';
import type { RiderAlert } from '../useSystemAlerts';

/**
 * AlertsScreen — the rider's system alerts (escalations, penalties, stale-order
 * releases). Alerts are polled app-wide by useSystemAlerts (so they ring on any
 * tab); this screen renders that shared list and clears the unread badge on open.
 */
export function AlertsScreen({
  alerts,
  onSeen,
}: {
  alerts: RiderAlert[];
  onSeen: () => void;
}) {
  const { t } = useLang();

  // Opening the tab marks everything currently loaded as seen.
  useEffect(() => { onSeen(); }, [onSeen]);

  return (
    <Screen>
      {alerts.length === 0 ? (
        <Card>
          <Text style={styles.emptyTitle}>{t.alerts.emptyTitle}</Text>
          <Text style={styles.emptyBody}>{t.alerts.emptyBody}</Text>
        </Card>
      ) : (
        <Card>
          <Text style={styles.title}>📋 {t.alerts.title}</Text>
          {alerts.map((n) => (
            <View key={n.id} style={[styles.row, n.isWarning && styles.rowWarn]}>
              <Text style={styles.icon}>{n.isWarning ? '⚠️' : 'ℹ️'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.msg, n.isWarning && styles.msgWarn]}>{n.message}</Text>
                <Text style={styles.time}>
                  {new Date(n.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.text, marginBottom: theme.space.sm, textTransform: 'uppercase', letterSpacing: 0.4 },
  row: { flexDirection: 'row', gap: theme.space.sm, paddingVertical: theme.space.sm, borderTopWidth: 1, borderTopColor: theme.color.border },
  rowWarn: { backgroundColor: '#FFFBEB', marginHorizontal: -theme.space.md, paddingHorizontal: theme.space.md },
  icon: { fontSize: 16, marginTop: 1 },
  msg: { fontSize: theme.font.small, color: theme.color.text, lineHeight: 18 },
  msgWarn: { color: '#92400E', fontWeight: '600' },
  time: { fontSize: theme.font.tiny, color: theme.color.textFaint, marginTop: 2 },
  emptyTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  emptyBody: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space.xs },
});
