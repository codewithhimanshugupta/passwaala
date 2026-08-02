import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, APP_TYPE } from '../api';
import { theme } from '../theme';
import { Banner, Button, ErrorText, OtpBoxes } from '../ui';
import { useLang } from '../i18n/LanguageContext';

export function LoginScreen({
  onLoggedIn,
  sessionExpired = false,
  onSignUp,
}: {
  onLoggedIn: () => void;
  sessionExpired?: boolean;
  onSignUp?: () => void;
}) {
  const { t } = useLang();
  const [phone, setPhone] = useState('');
  const [credential, setCredential] = useState('');
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [step, setStep] = useState<'phone' | 'credential'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneValid = phone.replace(/\D/g, '').length >= 10;

  function goToCredential() {
    if (!phoneValid) { setError(t.login.invalidPhone); return; }
    setError(null);
    setStep('credential');
  }

  async function login() {
    const cred = credential.trim();
    if (!cred) { setError(t.login.enterCredential); return; }
    setBusy(true); setError(null);
    try {
      const { accessToken } = await api.login(`+91${phone.trim()}`, cred, APP_TYPE);
      api.setToken(accessToken);
      onLoggedIn();
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
        {sessionExpired ? <Banner tone="warning" message={t.login.sessionExpired} /> : null}

        {step === 'phone' ? (
          <>
            <Text style={styles.label}>{t.login.enterMobile}</Text>
            <View style={styles.phoneRow}>
              <View style={styles.ccBox}><Text style={styles.ccText}>🇮🇳 +91</Text></View>
              <TextInput
                style={styles.phoneInput}
                placeholder={t.login.phonePlaceholder}
                placeholderTextColor={theme.color.textFaint}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={(v) => { setPhone(v.replace(/\D/g, '').slice(0, 10)); setError(null); }}
                maxLength={10}
                autoFocus
                onSubmitEditing={goToCredential}
              />
            </View>
            <Button label={t.login.continue} onPress={goToCredential} />
            {onSignUp ? (
              <Text style={styles.switchLine}>
                {t.login.noAccount}{' '}
                <Text style={styles.switchLink} onPress={onSignUp}>{t.login.signUpLink}</Text>
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.label}>{mode === 'password' ? t.login.passwordLabel : t.login.otpLabel}</Text>
            <Text style={styles.hint}>
              +91 {phone} ·{' '}
              <Text style={styles.link} onPress={() => { setStep('phone'); setCredential(''); setError(null); }}>
                {t.common.change}
              </Text>
            </Text>

            {mode === 'otp' ? (
              <OtpBoxes length={6} value={credential} onChange={(v) => { setCredential(v); setError(null); }} onComplete={login} />
            ) : (
              <TextInput
                style={styles.credInput}
                placeholder={t.login.passwordPlaceholder}
                placeholderTextColor={theme.color.textFaint}
                secureTextEntry
                value={credential}
                onChangeText={(v) => { setCredential(v); setError(null); }}
                autoFocus
                onSubmitEditing={login}
              />
            )}

            <Button label={t.login.loginBtn} onPress={login} busy={busy} disabled={!credential.trim()} />

            <Pressable onPress={() => { setMode(mode === 'password' ? 'otp' : 'password'); setCredential(''); setError(null); }}>
              <Text style={styles.link}>
                {mode === 'password' ? t.login.useOtpInstead : t.login.usePasswordInstead}
              </Text>
            </Pressable>
          </>
        )}
        {error ? <ErrorText>{error}</ErrorText> : null}
      </View>

      <Text style={styles.footer}>{t.login.footer}</Text>
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
  label: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  hint: { fontSize: theme.font.small, color: theme.color.textMuted },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  ccBox: { borderWidth: 1.5, borderColor: theme.color.border, borderRadius: theme.radius.md, paddingHorizontal: theme.space.md, paddingVertical: 13, backgroundColor: theme.color.surfaceAlt },
  ccText: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text },
  phoneInput: { flex: 1, borderWidth: 1.5, borderColor: theme.color.border, borderRadius: theme.radius.md, paddingHorizontal: theme.space.md, paddingVertical: 13, fontSize: theme.font.h3, color: theme.color.text },
  credInput: {
    borderWidth: 1.5, borderColor: theme.color.border, borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md, paddingVertical: 14, fontSize: theme.font.h3,
    color: theme.color.text, backgroundColor: theme.color.surface,
  },
  link: { color: theme.color.accent, fontWeight: '700', textAlign: 'center', fontSize: theme.font.small },
  switchLine: { fontSize: theme.font.small, color: theme.color.textMuted, textAlign: 'center', marginTop: theme.space.sm },
  switchLink: { color: theme.color.accent, fontWeight: '700' },
  footer: { backgroundColor: theme.color.surface, textAlign: 'center', color: theme.color.textFaint, fontSize: theme.font.tiny, paddingHorizontal: theme.space.xl, paddingBottom: theme.space.lg },
});
