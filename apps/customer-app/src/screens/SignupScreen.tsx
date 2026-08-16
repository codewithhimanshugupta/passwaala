import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, APP_TYPE } from '../api';
import { friendlyMessage } from '@nearbaz/api-client';
import { theme } from '../theme';
import { Button } from '../ui';
import { PinBoxes } from '../PinBoxes';
import { useLang } from '../i18n/LanguageContext';
import { resendOtp, sendOtp, verifyOtp } from '../msg91';

/**
 * SignupScreen — mandatory phone verification via SMS OTP, then account details.
 * Three steps: (1) enter phone → send OTP, (2) verify OTP (number is locked;
 * "Change number" restarts from step 1), (3) name + password + 4-digit PIN.
 * The MSG91 access token from step 2 is sent to the backend, which re-verifies
 * it server-side before creating the account.
 */
export function SignupScreen({ onSignedUp, onBackToLogin, initialPhone, initialToken }: { onSignedUp: () => void; onBackToLogin: () => void; initialPhone?: string; initialToken?: string }) {
  const { t } = useLang();
  // If we arrived here from an OTP *login* of an unknown number, the phone is
  // already verified and we carry the (still-unspent) MSG91 token — jump
  // straight to the details step so the user isn't sent a second OTP.
  const [step, setStep] = useState<'phone' | 'otp' | 'details'>(initialToken ? 'details' : 'phone');
  const [phone, setPhone] = useState(initialPhone ?? '');
  const [otp, setOtp] = useState('');
  const [reqId, setReqId] = useState('');
  const [msg91Token, setMsg91Token] = useState(initialToken ?? '');
  const [name, setName] = useState('');
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
      setStep('details');
    } catch {
      setError(t.signup.otpInvalid);
    } finally { setBusy(false); }
  }

  async function submit(confirmOverride?: string) {
    const confirmValue = confirmOverride ?? confirmPin;
    if (name.trim().length < 2) { setError(t.signup.enterName); return; }
    if (password.trim().length < 4) { setError(t.signup.enterPassword); return; }
    if (!/^\d{4}$/.test(pin)) { setError(t.signup.enterPin); return; }
    if (pin !== confirmValue) { setError(t.signup.pinMismatch); return; }
    setBusy(true); setError(null);
    try {
      const { accessToken } = await api.signup(
        `+91${phone10}`,
        name.trim(),
        password,
        { pin, appType: APP_TYPE, msg91Token },
      );
      api.setToken(accessToken);
      onSignedUp();
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
        {step === 'phone' ? (
          <>
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
                  autoFocus
                />
              </View>
            </View>

            <Button label={t.signup.sendOtp} onPress={doSendOtp} busy={busy} size="lg" />

            <Text style={styles.switchLine}>
              {t.signup.haveAccount}{' '}
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

            <Button label={t.signup.verifyOtp} onPress={() => doVerifyOtp()} busy={busy} size="lg" disabled={otp.length !== 6} />
            <Text style={styles.switchLine}>
              <Text style={styles.switchLink} onPress={doResend}>{t.signup.resendOtp}</Text>
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.stepTitle}>{t.signup.detailsStepTitle}</Text>
            <Text style={styles.hint}>
              +91 {phone10} ·{' '}
              <Text style={styles.switchLink} onPress={restart}>{t.signup.changeNumber}</Text>
            </Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t.signup.nameLabel}</Text>
              <TextInput
                style={styles.field}
                placeholder={t.signup.namePlaceholder}
                placeholderTextColor={theme.color.textFaint}
                value={name}
                onChangeText={(v) => { setName(v); setError(null); }}
                autoFocus
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
          </>
        )}

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

  switchLine: { fontSize: theme.font.small, color: theme.color.textMuted, textAlign: 'center', marginTop: theme.space.sm },
  switchLink: { color: theme.color.primary, fontWeight: theme.weight.semibold },
  error: { color: theme.color.danger, textAlign: 'center', fontWeight: theme.weight.medium },
});
