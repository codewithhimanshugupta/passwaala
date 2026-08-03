import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, updateName } from '../api';
import { theme } from '../theme';
import { Button } from '../ui';
import { useLang } from '../i18n/LanguageContext';
import { LanguagePicker } from '../components/LanguagePicker';

/**
 * NameOnboardingScreen — a one-time "What's your name?" step shown right after
 * OTP login when the account has no display name yet. Saves via updateName()
 * (PATCH /account/me) then hands control back to the app to enter the tabs.
 * Existing users with a name never see this (App.tsx gates it).
 *
 * Also offers an OPTIONAL referral code (plan → Referral program): if entered,
 * we apply it before continuing, but an invalid code never blocks onboarding.
 */
export function NameOnboardingScreen({ onDone }: { onDone: (name: string) => void }) {
  const { t } = useLang();
  const [name, setName] = useState('');
  const [referral, setReferral] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referralNote, setReferralNote] = useState<string | null>(null);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t.onboarding.enterName);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateName(trimmed);
      // Optional referral — apply if provided; a bad code just shows a note,
      // it never blocks the user from continuing.
      const code = referral.trim();
      if (code) {
        try {
          await api.applyReferral(code);
        } catch (e) {
          setReferralNote((e as Error).message || t.onboarding.referralFailed);
        }
      }
      onDone(trimmed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.hero}>
        <Text style={styles.title}>{t.onboarding.title}</Text>
        <Text style={styles.subtitle}>{t.onboarding.subtitle}</Text>
      </View>

      <View style={styles.sheet}>
        <LanguagePicker label={t.onboarding.chooseLanguage} />

        <Text style={styles.label}>{t.onboarding.yourName}</Text>
        <TextInput
          style={styles.input}
          placeholder={t.onboarding.namePlaceholder}
          placeholderTextColor={theme.color.textFaint}
          value={name}
          onChangeText={(t) => {
            setName(t);
            setError(null);
          }}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={save}
        />

        <Text style={styles.label}>{t.onboarding.referralLabel}</Text>
        <TextInput
          style={styles.input}
          placeholder={t.onboarding.referralPlaceholder}
          placeholderTextColor={theme.color.textFaint}
          autoCapitalize="characters"
          value={referral}
          onChangeText={(t) => {
            setReferral(t);
            setReferralNote(null);
          }}
        />
        <Text style={styles.hint}>{t.onboarding.referralHint}</Text>

        <Button label={t.onboarding.continue} onPress={save} busy={busy} size="lg" />
        {referralNote ? <Text style={styles.note}>{referralNote}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.primary },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space.sm,
    padding: theme.space.xl,
  },
  emoji: { fontSize: 56, marginBottom: theme.space.sm },
  title: { fontSize: theme.font.hero, fontWeight: theme.weight.heavy, color: theme.color.onPrimary, textAlign: 'center' },
  subtitle: { fontSize: theme.font.h3, color: '#D7F0E3', textAlign: 'center' },

  sheet: {
    backgroundColor: theme.color.bg,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    padding: theme.space.xl,
    gap: theme.space.md,
  },
  label: { fontSize: theme.font.h3, fontWeight: theme.weight.bold, color: theme.color.text },
  input: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 14,
    fontSize: theme.font.h3,
    color: theme.color.text,
  },
  error: { color: theme.color.danger, textAlign: 'center', fontWeight: theme.weight.medium },
  hint: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: -theme.space.xs },
  note: { color: theme.color.warning, textAlign: 'center', fontSize: theme.font.small },
});
