import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, APP_TYPE } from '../api';
import { theme } from '../theme';
import { Banner, Button, ErrorText } from '../ui';
import { PinBoxes } from '../PinBoxes';
import { useLang } from '../i18n/LanguageContext';
import { resendOtp, sendOtp, verifyOtp } from '../msg91';

export function LoginScreen({
  onLoggedIn,
  sessionExpired = false,
  onSignUp,
  onForgot,
}: {
  onLoggedIn: () => void;
  sessionExpired?: boolean;
  onSignUp?: () => void;
  onForgot?: () => void;
}) {
  const { t } = useLang();
  const [phone, setPhone] = useState('');
  const [credential, setCredential] = useState('');
  // Three distinct login methods, each with its own input.
  const [method, setMethod] = useState<'pin' | 'password' | 'otp'>('pin');
  const [step, setStep] = useState<'phone' | 'credential'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // OTP-login sub-state (only used when method === 'otp').
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpReqId, setOtpReqId] = useState('');

  const phone10 = phone.replace(/\D/g, '');
  const phoneValid = phone10.length >= 10;

  function goToCredential() {
    if (!phoneValid) { setError(t.login.invalidPhone); return; }
    setError(null);
    setStep('credential');
  }

  function selectMethod(m: 'pin' | 'password' | 'otp') {
    setMethod(m);
    setCredential('');
    setOtpSent(false);
    setOtpCode('');
    setOtpReqId('');
    setError(null);
  }

  async function doSendOtp() {
    setBusy(true); setError(null);
    try {
      const id = await sendOtp(phone10);
      setOtpReqId(id);
      setOtpSent(true);
    } catch {
      setError(t.signup.otpSendFailed);
    } finally { setBusy(false); }
  }

  async function doResendOtp() {
    setBusy(true); setError(null);
    try {
      await resendOtp(otpReqId);
    } catch {
      setError(t.signup.otpSendFailed);
    } finally { setBusy(false); }
  }

  async function loginWithOtp(codeOverride?: string) {
    const code = (codeOverride ?? otpCode).replace(/\D/g, '');
    if (code.length !== 6) { setError(t.login.enterAllDigits); return; }
    setBusy(true); setError(null);
    try {
      const token = await verifyOtp(otpReqId, code);
      const { accessToken } = await api.verifyOtp(`+91${phone10}`, APP_TYPE, token, code);
      api.setToken(accessToken);
      onLoggedIn();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function login(credOverride?: string) {
    const cred = (credOverride ?? credential).trim();
    if (method === 'pin' && !/^\d{4}$/.test(cred)) { setError(t.login.enterPin); return; }
    if (!cred) { setError(t.login.enterCredential); return; }
    setBusy(true); setError(null);
    try {
      const { accessToken } = await api.login(`+91${phone10}`, cred, {
        method: method === 'pin' ? 'pin' : 'password',
        appType: APP_TYPE,
      });
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
        <Text style={styles.brand}>NearBaz</Text>
        <Text style={styles.partnerPill}>{t.login.partner}</Text>
        <Text style={styles.tagline}>{t.login.tagline}</Text>
      </View>

      <View style={styles.form}>
        {sessionExpired ? (
          <Banner tone="warning" message={t.login.sessionExpired} />
        ) : null}

        {step === 'phone' ? (
          <>
            <Text style={styles.hint}>{t.login.phoneLabel}</Text>
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
            <Text style={styles.hint}>
              +91 {phone} ·{' '}
              <Text style={styles.changeLink} onPress={() => { setStep('phone'); setCredential(''); setError(null); }}>
                {t.login.changeNumber}
              </Text>
            </Text>

            {/* Three separate login methods */}
            <View style={styles.methodTabs}>
              <MethodTab label={t.login.methodPin} active={method === 'pin'} onPress={() => selectMethod('pin')} />
              <MethodTab label={t.login.methodPassword} active={method === 'password'} onPress={() => selectMethod('password')} />
              <MethodTab label={t.login.methodOtp} active={method === 'otp'} onPress={() => selectMethod('otp')} />
            </View>

            {method === 'otp' ? (
              !otpSent ? (
                <>
                  <Text style={styles.stepTitle}>{t.login.otpLabel}</Text>
                  <Text style={styles.hint}>{t.login.otpHint}</Text>
                  <Button label={t.login.sendOtp} onPress={doSendOtp} busy={busy} />
                </>
              ) : (
                <>
                  <Text style={styles.stepTitle}>{t.login.verifyOtp}</Text>
                  <PinBoxes
                    length={6}
                    mask={false}
                    value={otpCode}
                    onChange={(v) => { setOtpCode(v); setError(null); }}
                    onComplete={(v) => loginWithOtp(v)}
                    autoFocus
                  />
                  <Button label={t.login.verifyContinue} onPress={() => loginWithOtp()} busy={busy} disabled={otpCode.length !== 6} />
                  <Text style={styles.switchLine}>
                    <Text style={styles.switchLink} onPress={doResendOtp}>{t.signup.resendOtp}</Text>
                  </Text>
                </>
              )
            ) : (
              <>
                <Text style={styles.stepTitle}>
                  {method === 'pin' ? t.login.pinLabel : t.login.passwordLabel}
                </Text>
                {method === 'pin' ? (
                  <PinBoxes
                    value={credential}
                    onChange={(v) => { setCredential(v); setError(null); }}
                    onComplete={(v) => login(v)}
                    autoFocus
                  />
                ) : (
                  <TextInput
                    style={styles.credInput}
                    placeholder={t.login.passwordPlaceholder}
                    placeholderTextColor={theme.color.textFaint}
                    secureTextEntry
                    keyboardType="default"
                    value={credential}
                    onChangeText={(v) => {
                      setCredential(v);
                      setError(null);
                    }}
                    autoFocus
                    onSubmitEditing={() => login()}
                  />
                )}
                <Button
                  label={t.login.loginBtn}
                  onPress={() => login()}
                  busy={busy}
                  disabled={method === 'pin' ? credential.length !== 4 : !credential.trim()}
                />
              </>
            )}

            {onForgot ? (
              <Text style={styles.switchLine}>
                <Text style={styles.switchLink} onPress={onForgot}>{t.login.forgotLink}</Text>
              </Text>
            ) : null}
          </>
        )}

        {error ? <ErrorText>{error}</ErrorText> : null}
      </View>

      <Text style={styles.footer}>
        {t.login.footer}
      </Text>
    </KeyboardAvoidingView>
  );
}

/** A single method selector tab (PIN / Password / OTP). */
function MethodTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.methodTab, active && styles.methodTabActive]}>
      <Text style={[styles.methodTabText, active && styles.methodTabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.accent },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space.sm,
    padding: theme.space.xl,
  },
  logoBadge: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: theme.color.white,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: theme.space.sm,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  logoMark: { fontSize: 36, fontWeight: '900', color: theme.color.accent },
  brand: { fontSize: theme.font.h1, fontWeight: '900', color: theme.color.white, letterSpacing: 0.5 },
  partnerPill: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    color: theme.color.white,
    fontSize: theme.font.small,
    fontWeight: '800',
    paddingHorizontal: theme.space.md,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    letterSpacing: 1,
  },
  tagline: { fontSize: theme.font.small, color: 'rgba(255,255,255,0.8)', textAlign: 'center' },
  form: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: theme.space.xl,
    gap: theme.space.md,
  },
  stepTitle: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text },
  hint: { fontSize: theme.font.small, color: theme.color.textMuted },
  changeLink: { color: theme.color.accent, fontWeight: '700' },
  methodTabs: {
    flexDirection: 'row',
    gap: theme.space.xs,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 4,
  },
  methodTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
  },
  methodTabActive: {
    backgroundColor: theme.color.surface,
    ...(Platform.OS === 'web' ? {} : { elevation: 1 }),
  },
  methodTabText: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  methodTabTextActive: { color: theme.color.accent, fontWeight: '800' },
  switchLine: { fontSize: theme.font.small, color: theme.color.textMuted, textAlign: 'center', marginTop: theme.space.sm },
  switchLink: { color: theme.color.accent, fontWeight: '700' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  ccBox: { borderWidth: 1.5, borderColor: theme.color.border, borderRadius: theme.radius.md, paddingHorizontal: theme.space.md, paddingVertical: 13, backgroundColor: theme.color.surfaceAlt },
  ccText: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text },
  phoneInput: { flex: 1, borderWidth: 1.5, borderColor: theme.color.border, borderRadius: theme.radius.md, paddingHorizontal: theme.space.md, paddingVertical: 13, fontSize: theme.font.h3, color: theme.color.text },
  credInput: {
    borderWidth: 1.5,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 14,
    fontSize: theme.font.h3,
    color: theme.color.text,
    backgroundColor: theme.color.surface,
  },
  footer: { backgroundColor: theme.color.surface, textAlign: 'center', color: theme.color.textFaint, fontSize: theme.font.tiny, paddingHorizontal: theme.space.xl, paddingBottom: theme.space.lg },
});
