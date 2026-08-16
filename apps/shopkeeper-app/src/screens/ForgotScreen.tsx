import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, APP_TYPE } from '../api';
import { theme } from '../theme';
import { Button, ErrorText } from '../ui';
import { PinBoxes } from '../PinBoxes';
import { useLang } from '../i18n/LanguageContext';
import { resendOtp, sendOtp, verifyOtp } from '../msg91';

/**
 * ForgotScreen — reset password and/or PIN after SMS OTP verification.
 * Three steps: (1) enter phone → send OTP, (2) verify OTP (number locked;
 * "Change number" restarts), (3) set new password + new 4-digit PIN.
 * The account must already exist — the backend does not create one here.
 */
export function ForgotScreen({ onDone, onBackToLogin }: { onDone: () => void; onBackToLogin: () => void }) {
  const { t } = useLang();
  const [step, setStep] = useState<'phone' | 'otp' | 'reset'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [reqId, setReqId] = useState('');
  const [msg91Token, setMsg91Token] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phone10 = phone.replace(/\D/g, '');
  const phoneValid = phone10.length >= 10;

  function restart() {
    setStep('phone');
    setOtp('');
    setReqId('');
    setMsg91Token('');
    setError(null);
  }

  async function doSendOtp() {
    if (!phoneValid) { setError(t.login.invalidPhone); return; }
    setBusy(true); setError(null);
    try {
      const id = await sendOtp(phone10);
      setReqId(id);
      setStep('otp');
    } catch {
      setError(t.signup.otpSendFailed);
    } finally { setBusy(false); }
  }

  async function doResend() {
    setBusy(true); setError(null);
    try {
      await resendOtp(reqId);
    } catch {
      setError(t.signup.otpSendFailed);
    } finally { setBusy(false); }
  }

  async function doVerifyOtp(codeOverride?: string) {
    const code = (codeOverride ?? otp).replace(/\D/g, '');
    if (code.length !== 6) { setError(t.login.enterAllDigits); return; }
    setBusy(true); setError(null);
    try {
      const token = await verifyOtp(reqId, code);
      setMsg91Token(token);
      setStep('reset');
    } catch {
      setError(t.signup.otpInvalid);
    } finally { setBusy(false); }
  }

  async function submit(confirmOverride?: string) {
    const confirmValue = confirmOverride ?? confirmPin;
    if (password.trim().length < 4) { setError(t.signup.enterPassword); return; }
    if (!/^\d{4}$/.test(pin)) { setError(t.signup.enterPin); return; }
    if (pin !== confirmValue) { setError(t.signup.pinMismatch); return; }
    setBusy(true); setError(null);
    try {
      await api.resetCredentials(`+91${phone10}`, msg91Token, {
        newPassword: password,
        newPin: pin,
        appType: APP_TYPE,
      });
      onDone();
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
        {step === 'phone' ? (
          <>
            <Text style={styles.stepTitle}>{t.forgot.title}</Text>
            <Text style={styles.hint}>{t.forgot.subtitle}</Text>

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
                  autoFocus
                />
              </View>
            </View>

            <Button label={t.signup.sendOtp} onPress={doSendOtp} busy={busy} />

            <Text style={styles.switchLine}>
              <Text style={styles.switchLink} onPress={onBackToLogin}>{t.signup.loginLink}</Text>
            </Text>
          </>
        ) : step === 'otp' ? (
          <>
            <Text style={styles.stepTitle}>{t.signup.otpStepTitle}</Text>
            <Text style={styles.hint}>
              {t.signup.otpSentHint(phone10)} ·{' '}
              <Text style={styles.switchLink} onPress={restart}>{t.signup.changeNumber}</Text>
            </Text>

            <PinBoxes
              length={6}
              mask={false}
              value={otp}
              onChange={(v) => { setOtp(v); setError(null); }}
              onComplete={(v) => doVerifyOtp(v)}
              autoFocus
            />

            <Button label={t.signup.verifyOtp} onPress={() => doVerifyOtp()} busy={busy} disabled={otp.length !== 6} />
            <Text style={styles.switchLine}>
              <Text style={styles.switchLink} onPress={doResend}>{t.signup.resendOtp}</Text>
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.stepTitle}>{t.forgot.resetStepTitle}</Text>
            <Text style={styles.hint}>+91 {phone10}</Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t.forgot.newPasswordLabel}</Text>
              <TextInput
                style={styles.field}
                placeholder={t.signup.passwordPlaceholder}
                placeholderTextColor={theme.color.textFaint}
                secureTextEntry
                value={password}
                onChangeText={(v) => { setPassword(v); setError(null); }}
                autoFocus
              />
            </View>

            <PinBoxes
              label={t.forgot.newPinLabel}
              value={pin}
              onChange={(v) => { setPin(v); setError(null); }}
            />

            <PinBoxes
              label={t.signup.confirmPinLabel}
              value={confirmPin}
              onChange={(v) => { setConfirmPin(v); setError(null); }}
              onComplete={(v) => submit(v)}
            />

            <Button label={t.forgot.submit} onPress={() => submit()} busy={busy} />
          </>
        )}

        {error ? <ErrorText>{error}</ErrorText> : null}
      </View>
    </KeyboardAvoidingView>
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
