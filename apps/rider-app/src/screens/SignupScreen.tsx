import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, APP_TYPE } from '../api';
import { theme } from '../theme';
import { Button, ErrorText } from '../ui';
import { PinBoxes } from '../PinBoxes';
import { useLang } from '../i18n/LanguageContext';

/**
 * SignupScreen — phone + name + password + a user-chosen 4-digit login PIN
 * (set + confirmed). No SMS, no backup OTP. On success we store the token and
 * hand off to the app's normal post-login flow (resolveRider →
 * RegisterRiderScreen for a brand-new rider).
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
    if (!phoneValid) { setError(t.login.invalidPhone); return; }
    if (name.trim().length < 2) { setError(t.signup.enterName); return; }
    if (password.trim().length < 4) { setError(t.signup.enterPassword); return; }
    if (!/^\d{4}$/.test(pin)) { setError(t.signup.enterPin); return; }
    if (pin !== (confirmOverride ?? confirmPin)) { setError(t.signup.pinMismatch); return; }
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
        <View style={styles.logoBadge}>
          <Text style={styles.logoMark}>P</Text>
        </View>
        <Text style={styles.brand}>PassWaala</Text>
        <Text style={styles.partnerPill}>{t.login.partnerPill}</Text>
        <Text style={styles.tagline}>{t.login.tagline}</Text>
      </View>

      <View style={styles.form}>
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

        <Button label={t.signup.submit} onPress={() => submit()} busy={busy} />

        <Text style={styles.switchLine}>
          {t.signup.haveAccount}{' '}
          <Text style={styles.switchLink} onPress={onBackToLogin}>{t.signup.loginLink}</Text>
        </Text>

        {error ? <ErrorText>{error}</ErrorText> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.accent },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space.sm, padding: theme.space.xl },
  logoBadge: {
    width: 72, height: 72, borderRadius: 20, backgroundColor: theme.color.white,
    alignItems: 'center', justifyContent: 'center', marginBottom: theme.space.sm,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  logoMark: { fontSize: 36, fontWeight: '900', color: theme.color.accent },
  brand: { fontSize: theme.font.h1, fontWeight: '900', color: theme.color.white, letterSpacing: 0.5 },
  partnerPill: {
    backgroundColor: 'rgba(255,255,255,0.25)', color: theme.color.white,
    fontSize: theme.font.small, fontWeight: '800',
    paddingHorizontal: theme.space.md, paddingVertical: 4,
    borderRadius: theme.radius.pill, overflow: 'hidden', letterSpacing: 1,
  },
  tagline: { fontSize: theme.font.small, color: 'rgba(255,255,255,0.8)', textAlign: 'center' },
  form: { backgroundColor: theme.color.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: theme.space.xl, gap: theme.space.md },
  stepTitle: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text },
  hint: { fontSize: theme.font.small, color: theme.color.textMuted },
  label: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  ccBox: { borderWidth: 1.5, borderColor: theme.color.border, borderRadius: theme.radius.md, paddingHorizontal: theme.space.md, paddingVertical: 13, backgroundColor: theme.color.surfaceAlt },
  ccText: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text },
  phoneInput: { flex: 1, borderWidth: 1.5, borderColor: theme.color.border, borderRadius: theme.radius.md, paddingHorizontal: theme.space.md, paddingVertical: 13, fontSize: theme.font.h3, color: theme.color.text },
  field: {
    borderWidth: 1.5, borderColor: theme.color.border, borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md, paddingVertical: 14, fontSize: theme.font.h3,
    color: theme.color.text, backgroundColor: theme.color.surface,
  },
  switchLine: { fontSize: theme.font.small, color: theme.color.textMuted, textAlign: 'center', marginTop: theme.space.sm },
  switchLink: { color: theme.color.accent, fontWeight: '700' },
});
