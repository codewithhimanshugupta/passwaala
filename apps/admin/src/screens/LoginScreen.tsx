import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, APP_TYPE } from '../api';
import { theme } from '../theme';
import { PinBoxes } from '../PinBoxes';
import { useLang } from '../i18n/LanguageContext';

export function LoginScreen({
  onLoggedIn,
  sessionExpired,
}: {
  onLoggedIn: () => void;
  sessionExpired?: boolean;
}) {
  const { t } = useLang();
  const [phone, setPhone] = useState('');
  const [credential, setCredential] = useState('');
  // Three distinct login methods, each with its own input.
  const [method, setMethod] = useState<'pin' | 'password' | 'otp'>('pin');
  const [step, setStep] = useState<'phone' | 'credential'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneValid = phone.replace(/\D/g, '').length === 10;
  const canSubmit =
    method === 'pin' ? /^\d{4}$/.test(credential) : credential.trim().length > 0;

  function goToCredential() {
    if (!phoneValid) { setError(t.login.invalidPhone); return; }
    setError(null);
    setStep('credential');
  }

  function selectMethod(m: 'pin' | 'password' | 'otp') {
    setMethod(m);
    setCredential('');
    setError(null);
  }

  async function login(credOverride?: string) {
    if (method === 'otp') { setError(t.login.otpComingSoon); return; }
    const cred = (credOverride ?? credential).trim();
    if (method === 'pin' && !/^\d{4}$/.test(cred)) { setError(t.login.enterPin); return; }
    if (!cred) { setError(t.login.enterCredential); return; }
    setBusy(true); setError(null);
    try {
      const { accessToken } = await api.login(phone.replace(/\D/g, '').slice(-10), cred, {
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
    <View style={s.screen}>
      <View style={s.card}>
        <View style={s.brandRow}>
          <View style={s.logoMark}><Text style={s.logoText}>PW</Text></View>
          <View>
            <Text style={s.title}>{t.login.title}</Text>
            <Text style={s.subtitle}>{t.login.subtitle}</Text>
          </View>
        </View>

        {sessionExpired ? <View style={s.expired}><Text style={s.expiredText}>{t.login.sessionExpired}</Text></View> : null}

        {step === 'phone' ? (
          <>
            <Text style={s.label}>{t.login.phoneLabel}</Text>
            <View style={s.phoneRow}>
              <View style={s.cc}><Text style={s.ccText}>+91</Text></View>
              <TextInput
                style={s.phoneInput}
                placeholder="10-digit mobile number"
                placeholderTextColor={theme.color.textFaint}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={v => { setPhone(v.replace(/\D/g, '').slice(0, 10)); setError(null); }}
                maxLength={10}
                autoFocus
                onSubmitEditing={goToCredential}
              />
            </View>
            <Pressable
              style={[s.btn, !phoneValid && s.btnDim]}
              onPress={goToCredential}
              disabled={!phoneValid}
            >
              <Text style={s.btnText}>{t.login.continue}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={s.otpSub}>+91 {phone} · <Text style={s.changeLink} onPress={() => { setStep('phone'); setCredential(''); setError(null); }}>{t.login.changeNumber}</Text></Text>

            {/* Three separate login methods */}
            <View style={s.methodTabs}>
              <MethodTab label={t.login.methodPin} active={method === 'pin'} onPress={() => selectMethod('pin')} />
              <MethodTab label={t.login.methodPassword} active={method === 'password'} onPress={() => selectMethod('password')} />
              <MethodTab label={t.login.methodOtp} active={method === 'otp'} onPress={() => selectMethod('otp')} />
            </View>

            {method === 'otp' ? (
              <View style={s.comingSoon}>
                <Text style={s.comingSoonText}>{t.login.otpComingSoon}</Text>
              </View>
            ) : (
              <>
                <Text style={s.label}>{method === 'pin' ? t.login.pinLabel : t.login.passwordLabel}</Text>
                {method === 'pin' ? (
                  <PinBoxes
                    value={credential}
                    onChange={(v) => { setCredential(v); setError(null); }}
                    onComplete={(v) => login(v)}
                    autoFocus
                  />
                ) : (
                  <TextInput
                    style={s.credInput}
                    placeholder={t.login.passwordPlaceholder}
                    placeholderTextColor={theme.color.textFaint}
                    secureTextEntry
                    value={credential}
                    onChangeText={v => { setCredential(v); setError(null); }}
                    autoFocus
                    onSubmitEditing={() => login()}
                  />
                )}
                <Pressable
                  style={[s.btn, (busy || !canSubmit) && s.btnDim]}
                  onPress={() => login()}
                  disabled={busy || !canSubmit}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{t.login.signIn}</Text>}
                </Pressable>
              </>
            )}
          </>
        )}

        {error ? <Text style={s.error}>{error}</Text> : null}

        <View style={s.hint}>
          <Text style={s.hintTitle}>{t.login.testerNote}</Text>
          <Text style={s.hintBody}>Admin: <Text style={s.hintCode}>9000000002</Text> · Owner: <Text style={s.hintCode}>9000000001</Text></Text>
          {step === 'phone' ? (
            <View style={s.hintBtns}>
              <Pressable onPress={() => setPhone('9000000002')} style={s.hintBtn}>
                <Text style={s.hintBtnText}>Use admin number</Text>
              </Pressable>
              <Pressable onPress={() => setPhone('9000000001')} style={s.hintBtn}>
                <Text style={s.hintBtnText}>Use owner number</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** A single method selector tab (PIN / Password / OTP). */
function MethodTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.methodTab, active && s.methodTabActive]}>
      <Text style={[s.methodTabText, active && s.methodTabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.bg, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },
  card: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, padding: theme.space.xl, width: '100%', maxWidth: 400, gap: theme.space.md, ...theme.shadow.card },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, marginBottom: theme.space.sm },
  logoMark: { width: 44, height: 44, borderRadius: theme.radius.md, backgroundColor: theme.color.primary, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#fff', fontWeight: '900', fontSize: 18 },
  title: { fontSize: theme.font.h2, fontWeight: '800', color: theme.color.text },
  subtitle: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  expired: { backgroundColor: theme.color.warningBg, borderRadius: theme.radius.md, padding: theme.space.md },
  expiredText: { color: theme.color.warning, fontSize: theme.font.small, fontWeight: '600' },
  label: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  otpSub: { fontSize: theme.font.small, color: theme.color.textMuted },
  changeLink: { color: theme.color.accent, fontWeight: '700' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt },
  cc: { paddingHorizontal: theme.space.md, paddingVertical: 12, borderRightWidth: 1, borderRightColor: theme.color.borderStrong },
  ccText: { fontSize: theme.font.body, color: theme.color.text, fontWeight: '600' },
  phoneInput: { flex: 1, padding: theme.space.md, fontSize: theme.font.body, color: theme.color.text },
  credInput: { borderWidth: 1.5, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt, padding: theme.space.md, fontSize: theme.font.body, color: theme.color.text },
  methodTabs: { flexDirection: 'row', gap: theme.space.xs, backgroundColor: theme.color.surfaceAlt, borderRadius: theme.radius.md, padding: 4 },
  methodTab: { flex: 1, paddingVertical: 10, borderRadius: theme.radius.sm, alignItems: 'center' },
  methodTabActive: { backgroundColor: theme.color.surface, ...theme.shadow.card },
  methodTabText: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.textMuted },
  methodTabTextActive: { color: theme.color.accent },
  comingSoon: { backgroundColor: theme.color.warningBg, borderRadius: theme.radius.md, padding: theme.space.md },
  comingSoonText: { color: theme.color.warning, fontSize: theme.font.small, fontWeight: '600', textAlign: 'center' },
  btn: { backgroundColor: theme.color.primary, borderRadius: theme.radius.md, paddingVertical: 14, alignItems: 'center' },
  btnDim: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: theme.font.body },
  error: { color: theme.color.critical, fontSize: theme.font.small, fontWeight: '600', textAlign: 'center' },
  hint: { backgroundColor: theme.color.surfaceAlt, borderRadius: theme.radius.md, padding: theme.space.md, gap: theme.space.xs },
  hintTitle: { fontSize: theme.font.tiny, fontWeight: '800', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  hintBody: { fontSize: theme.font.small, color: theme.color.textMuted, lineHeight: 18 },
  hintCode: { fontWeight: '800', color: theme.color.text, fontFamily: 'monospace' },
  hintBtns: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.xs },
  hintBtn: { flex: 1, backgroundColor: theme.color.surface, borderRadius: theme.radius.md, paddingVertical: theme.space.sm, alignItems: 'center', borderWidth: 1, borderColor: theme.color.border },
  hintBtnText: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.text },
});
