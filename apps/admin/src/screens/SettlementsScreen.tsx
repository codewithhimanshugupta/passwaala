import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme } from '../theme';
import { useLang } from '../i18n/LanguageContext';

/**
 * SettlementsScreen — recording offline payments now lives in the Shops console,
 * where each shop card shows its outstanding dues and a one-tap "Record ₹… paid"
 * action (no more pasting a raw shop ID). This screen just points operators there.
 */
export function SettlementsScreen({ onGoToShops }: { onGoToShops?: () => void }) {
  const { t } = useLang();
  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.h1}>{t.settlements.title}</Text>
          <Text style={styles.sub}>{t.settlements.subtitle}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t.settlements.movedTitle}</Text>
        <Text style={styles.cardHint}>
          {t.settlements.movedBody}
        </Text>
        {onGoToShops ? (
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
            onPress={onGoToShops}
          >
            <Text style={styles.primaryBtnText}>{t.settlements.openShops}</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: theme.space.xl, gap: theme.space.lg, maxWidth: 720 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  h1: { fontSize: theme.font.h1, fontWeight: '800', color: theme.color.text },
  sub: { fontSize: theme.font.body, color: theme.color.textMuted, marginTop: 2 },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.lg,
    gap: theme.space.md,
    ...theme.shadow.card,
  },
  cardTitle: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  cardHint: { fontSize: theme.font.body, color: theme.color.textMuted, lineHeight: 21 },
  primaryBtn: {
    alignSelf: 'flex-start',
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.xl,
    alignItems: 'center',
    minWidth: 200,
  },
  primaryBtnPressed: { backgroundColor: theme.color.primaryDark },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.body },
});
