import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, APP_TYPE } from '../api';
import { theme } from '../theme';
import { Button } from '../ui';
import { PinBoxes } from '../PinBoxes';
import { useLang } from '../i18n/LanguageContext';

/**
 * SignupScreen — phone + name + password + a user-chosen 4-digit login PIN
 * (set + confirmed). No SMS, no backup OTP. On success we store the token and
 * hand off to the app's normal post-login flow.
 */
export function SignupScreen({ onSignedUp, onBackToLogin }: { onSignedUp: () => void; onBackToLogin: () => void }) {
  const { t } = useLang();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneValid = phone.replace(/\D/g, '').length >= 10;

  async function submit(confirmOverride?: string) {
    // On auto-fire, PinBoxes passes the just-completed confirm PIN so we don't
    // compare against stale state (the bug behind a false "PINs do not match").
    const confirmValue = confirmOverride ?? confirmPin;
    if (!phoneValid) { setError(t.login.invalidPhone); return; }
    if (name.trim().length < 2) { setError(t.signup.enterName); return; }
    if (password.trim().length < 4) { setError(t.signup.enterPassword); return; }
    if (!/^\d{4}$/.test(pin)) { setError(t.signup.enterPin); return; }
    if (pin !== confirmValue) { setError(t.signup.pinMismatch); return; }
    setBusy(true); setError(null);
    try {
      const { accessToken } = await api.signup(
        `+91${phone.replace(/\D/g, '')}`,
        name.trim(),
        password,
        { pin, appType: APP_TYPE },
      );
      api.setToken(accessToken);
      onSignedUp();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.hero}>
        <View style={styles.logoWrap}>
          <Text style={styles.logoMark}>प</Text>
        </View>
        <Text style={styles.brand}>PassWaala</Text>
        <Text style={styles.tagline}>{t.login.tagline}</Text>
      </View>

      <View style={styles.sheet}>
        <Text style={styles.stepTitle}>{t.signup.title}</Text>
        <Text style={styles.hint}>{t.signup.subtitle}</Text>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t.signup.phoneLabel}</Text>
          <View style={styles.phoneRow}>
            <View style={styles.ccBox}><Text style={styles.ccText}>+91</Text></View>
            <TextInput
              style={styles.phoneInput}
              placeholder={t.login.phonePlaceholder}
              placeholderTextColor={theme.color.textFaint}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={(v) => { setPhone(v.replace(/\D/g, '').slice(0, 10)); setError(null); }}
              maxLength={10}
            />
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t.signup.nameLabel}</Text>
          <TextInput
            style={styles.field}
            placeholder={t.signup.namePlaceholder}
            placeholderTextColor={theme.color.textFaint}
            value={name}
            onChangeText={(v) => { setName(v); setError(null); }}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t.signup.passwordLabel}</Text>
          <TextInput
            style={styles.field}
            placeholder={t.signup.passwordPlaceholder}
            placeholderTextColor={theme.color.textFaint}
            secureTextEntry
            value={password}
            onChangeText={(v) => { setPassword(v); setError(null); }}
          />
        </View>

        <PinBoxes
          label={t.signup.pinLabel}
          value={pin}
          onChange={(v) => { setPin(v); setError(null); }}
        />

        <PinBoxes
          label={t.signup.confirmPinLabel}
          value={confirmPin}
          onChange={(v) => { setConfirmPin(v); setError(null); }}
          onComplete={(v) => submit(v)}
        />

        <Button label={t.signup.submit} onPress={() => submit()} busy={busy} size="lg" />

        <Text style={styles.switchLine}>
          {t.signup.haveAccount}{' '}
          <Text style={styles.switchLink} onPress={onBackToLogin}>{t.signup.loginLink}</Text>
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.primary },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space.sm, padding: theme.space.xl },
  logoWrap: {
    width: 88, height: 88, borderRadius: 24, backgroundColor: theme.color.bg,
    alignItems: 'center', justifyContent: 'center', marginBottom: theme.space.md,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  logoMark: { fontSize: 46, fontWeight: theme.weight.heavy, color: theme.color.primary },
  brand: { fontSize: theme.font.hero, fontWeight: theme.weight.heavy, color: theme.color.onPrimary, letterSpacing: 0.5 },
  tagline: { fontSize: theme.font.body, color: '#C8EDD9', textAlign: 'center', marginTop: 2 },

  sheet: {
    backgroundColor: theme.color.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: theme.space.xl, paddingTop: 28, gap: theme.space.md,
  },
  stepTitle: { fontSize: theme.font.h2, fontWeight: theme.weight.heavy, color: theme.color.text },
  hint: { fontSize: theme.font.small, color: theme.color.textMuted },

  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  ccBox: {
    borderWidth: 1.5, borderColor: theme.color.border, borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md, paddingVertical: 13, backgroundColor: theme.color.surface,
  },
  ccText: { fontSize: theme.font.body, fontWeight: theme.weight.semibold, color: theme.color.text },
  phoneInput: {
    flex: 1, borderWidth: 1.5, borderColor: theme.color.border, borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md, paddingVertical: 13, fontSize: theme.font.h3, color: theme.color.text,
  },
  field: {
    borderWidth: 1.5, borderColor: theme.color.border, borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md, paddingVertical: 14, fontSize: theme.font.h3,
    color: theme.color.text, backgroundColor: theme.color.surface,
  },
  fieldGroup: { gap: 6 },
  fieldLabel: {
    fontSize: theme.font.small, fontWeight: theme.weight.semibold,
    color: theme.color.textMuted,
  },

  otpCard: {
    backgroundColor: theme.color.primaryLight, borderRadius: theme.radius.md,
    paddingVertical: theme.space.lg, alignItems: 'center',
  },
  otpBig: { fontSize: 40, fontWeight: theme.weight.heavy, color: theme.color.primary, letterSpacing: 6 },

  switchLine: { fontSize: theme.font.small, color: theme.color.textMuted, textAlign: 'center', marginTop: theme.space.sm },
  switchLink: { color: theme.color.primary, fontWeight: theme.weight.semibold },
  error: { color: theme.color.danger, textAlign: 'center', fontWeight: theme.weight.medium },
});
