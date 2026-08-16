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
import { ApiError, friendlyMessage } from '@nearbaz/api-client';
import { theme } from '../theme';
import { Button } from '../ui';
import { PinBoxes } from '../PinBoxes';
import { useLang } from '../i18n/LanguageContext';
import { resendOtp, sendOtp, verifyOtp } from '../msg91';

export function LoginScreen({ onLoggedIn, notice, onSignUp, onForgot }: { onLoggedIn: () => void; notice?: string; onSignUp?: (phone?: string, verifiedToken?: string) => void; onForgot?: () => void }) {
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
    let verifiedToken: string | undefined;
    try {
      const token = await verifyOtp(otpReqId, code);
      verifiedToken = token;
      // createIfMissing=false: OTP is a *login*, not signup. An unknown number
      // is rejected (404) and routed to the signup flow. The backend now checks
      // existence BEFORE spending the MSG91 token, so `token` is still valid —
      // pass it to signup so the phone isn't re-verified with a second SMS.
      const { accessToken } = await api.verifyOtp(`+91${phone10}`, APP_TYPE, token, code, false);
      api.setToken(accessToken);
      onLoggedIn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && onSignUp) {
        onSignUp(phone10, verifiedToken);
        return;
      }
      setError(friendlyMessage(e));
    } finally { setBusy(false); }
  }

  async function login(credOverride?: string) {
    // On PIN auto-fire, PinBoxes passes the completed value so we don't submit
    // stale state (which would send a 3-digit PIN and fail).
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
      setError(friendlyMessage(e));
    } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.hero}>
        <View style={styles.logoWrap}>
          <Text style={styles.logoMark}>N</Text>
        </View>
        <Text style={styles.brand}>NearBaz</Text>
        <Text style={styles.tagline}>{t.login.tagline}</Text>
      </View>

      <View style={styles.sheet}>
        {notice ? (
          <View style={styles.noticeBanner}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        {step === 'phone' ? (
          <>
            <Text style={styles.stepTitle}>{t.login.enterMobile}</Text>
            <View style={styles.phoneRow}>
              <View style={styles.ccBox}>
                <Text style={styles.ccText}>+91</Text>
              </View>
              <TextInput
                style={styles.phoneInput}
                placeholder={t.login.phonePlaceholder}
                placeholderTextColor={theme.color.textFaint}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={(v) => {
                  const digits = v.replace(/\D/g, '').slice(0, 10);
                  setPhone(digits);
                  setError(null);
                }}
                maxLength={10}
                autoFocus
                onSubmitEditing={goToCredential}
              />
            </View>
            <Button label={t.login.continue} onPress={goToCredential} size="lg" />
            {onSignUp ? (
              <Text style={styles.switchLine}>
                {t.login.noAccount}{' '}
                <Text style={styles.switchLink} onPress={() => onSignUp()}>{t.login.signUpLink}</Text>
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.hint}>
              +91 {phone} ·{' '}
              <Text style={styles.changeLink} onPress={() => { setStep('phone'); setCredential(''); setError(null); }}>
                {t.common.change}
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
                  <Button label={t.login.sendOtp} onPress={doSendOtp} busy={busy} size="lg" />
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
                  <Button label={t.login.verifyContinue} onPress={() => loginWithOtp()} busy={busy} size="lg" disabled={otpCode.length !== 6} />
                  <Text style={styles.switchLine}>
                    <Text style={styles.switchLink} onPress={doResendOtp}>{t.signup.resendOtp}</Text>
                  </Text>
                </>
              )
            ) : method === 'pin' ? (
              <>
                <Text style={styles.stepTitle}>{t.login.pinLabel}</Text>
                <PinBoxes
                  value={credential}
                  onChange={(v) => { setCredential(v); setError(null); }}
                  onComplete={(v) => login(v)}
                  autoFocus
                />
                <Button label={t.login.loginBtn} onPress={() => login()} busy={busy} size="lg" disabled={credential.length !== 4} />
              </>
            ) : (
              <>
                <Text style={styles.stepTitle}>{t.login.passwordLabel}</Text>
                <TextInput
                  style={styles.credInput}
                  placeholder={t.login.passwordPlaceholder}
                  placeholderTextColor={theme.color.textFaint}
                  secureTextEntry
                  value={credential}
                  onChangeText={(v) => { setCredential(v); setError(null); }}
                  autoFocus
                  onSubmitEditing={() => login()}
                />
                <Button label={t.login.loginBtn} onPress={() => login()} busy={busy} size="lg" disabled={!credential.trim()} />
              </>
            )}

            {onForgot ? (
              <Text style={styles.switchLine}>
                <Text style={styles.switchLink} onPress={onForgot}>{t.login.forgotLink}</Text>
              </Text>
            ) : null}
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
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
  root: { flex: 1, backgroundColor: theme.color.primary },

  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space.sm,
    padding: theme.space.xl,
  },
  logoWrap: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: theme.color.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.space.md,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  logoMark: { fontSize: 46, fontWeight: theme.weight.heavy, color: theme.color.primary },
  brand: { fontSize: theme.font.hero, fontWeight: theme.weight.heavy, color: theme.color.onPrimary, letterSpacing: 0.5 },
  tagline: { fontSize: theme.font.body, color: '#C8EDD9', textAlign: 'center', marginTop: 2 },

  sheet: {
    backgroundColor: theme.color.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: theme.space.xl,
    paddingTop: 28,
    gap: theme.space.md,
  },

  stepTitle: { fontSize: theme.font.h2, fontWeight: theme.weight.heavy, color: theme.color.text },
  hint: { fontSize: theme.font.small, color: theme.color.textMuted },
  changeLink: { color: theme.color.primary, fontWeight: theme.weight.semibold },

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
    backgroundColor: theme.color.bg,
    ...(Platform.OS === 'web' ? {} : { elevation: 1 }),
  },
  methodTabText: { fontSize: theme.font.small, fontWeight: theme.weight.semibold, color: theme.color.textMuted },
  methodTabTextActive: { color: theme.color.primary },

  comingSoonBox: {
    backgroundColor: theme.color.warningLight,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
  },
  comingSoonText: { color: theme.color.warning, fontSize: theme.font.small, fontWeight: theme.weight.semibold, textAlign: 'center' },

  switchLine: { fontSize: theme.font.small, color: theme.color.textMuted, textAlign: 'center', marginTop: theme.space.sm },
  switchLink: { color: theme.color.primary, fontWeight: theme.weight.semibold },
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

  noticeBanner: {
    backgroundColor: theme.color.warningLight,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  noticeText: { color: theme.color.warning, fontSize: theme.font.small, fontWeight: theme.weight.semibold, textAlign: 'center' },

  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  ccBox: {
    borderWidth: 1.5,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 13,
    backgroundColor: theme.color.surface,
  },
  ccText: { fontSize: theme.font.body, fontWeight: theme.weight.semibold, color: theme.color.text },
  phoneInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 13,
    fontSize: theme.font.h3,
    color: theme.color.text,
  },

  otpRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: theme.space.sm,
    marginVertical: theme.space.xs,
  },
  otpBox: {
    width: 48,
    height: 56,
    borderWidth: 2,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    fontSize: theme.font.h1,
    fontWeight: theme.weight.heavy,
    color: theme.color.text,
    backgroundColor: theme.color.surface,
    textAlign: 'center',
  },
  otpBoxFilled: {
    borderColor: theme.color.primary,
    backgroundColor: theme.color.primaryLight,
  },

  error: { color: theme.color.danger, textAlign: 'center', fontWeight: theme.weight.medium },
});
