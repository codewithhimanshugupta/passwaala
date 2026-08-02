import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import { useLang } from '../i18n/LanguageContext';
import type { Lang } from '../i18n/strings';

/**
 * LanguagePicker — a two-option segmented control (English / हिन्दी) bound to the
 * language context. Used on shop registration and in settings. Selecting a
 * language switches it app-wide immediately (and persists it).
 */
export function LanguagePicker({ label }: { label?: string }) {
  const { lang, t, setLang } = useLang();
  const options: { key: Lang; text: string }[] = [
    { key: 'en', text: t.common.languageEnglish },
    { key: 'hi', text: t.common.languageHindi },
  ];
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.segment}>
        {options.map((opt) => {
          const active = opt.key === lang;
          return (
            <Pressable
              key={opt.key}
              style={[styles.option, active && styles.optionActive]}
              onPress={() => setLang(opt.key)}
            >
              <Text style={[styles.optionText, active && styles.optionTextActive]}>{opt.text}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.space.xs },
  label: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  segment: {
    flexDirection: 'row',
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: 3,
    gap: 3,
  },
  option: {
    flex: 1,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
  },
  optionActive: { backgroundColor: theme.color.accent },
  optionText: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.textMuted },
  optionTextActive: { color: theme.color.white },
});
