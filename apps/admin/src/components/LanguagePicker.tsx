import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import { useLang } from '../i18n/LanguageContext';
import type { Lang } from '../i18n/strings';

/**
 * LanguagePicker — a two-option segmented control (English / हिन्दी) bound to the
 * language context. Placed in the admin sidebar near Logout, so it uses the dark
 * sidebar palette rather than the light content-surface tokens. Selecting a
 * language switches it app-wide immediately (and persists it).
 */
export function LanguagePicker({ label }: { label?: string }) {
  const { lang, setLang, t } = useLang();
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
  label: {
    fontSize: theme.font.tiny,
    fontWeight: '700',
    color: theme.color.sidebarText,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    padding: 3,
    gap: 3,
  },
  option: {
    flex: 1,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
  },
  optionActive: { backgroundColor: theme.color.sidebarActive },
  optionText: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.sidebarText },
  optionTextActive: { color: '#fff', fontWeight: '700' },
});
