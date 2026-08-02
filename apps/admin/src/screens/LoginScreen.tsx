import { useRef, useState } from 'react';
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
import { useLang } from '../i18n/LanguageContext';

function AdminOtpBoxes({ value, onChange, onComplete }: { value: string; onChange: (v: string) => void; onComplete: () => void }) {
  const refs = useRef<Array<TextInput | null>>(Array(6).fill(null));
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
  function handleChange(idx: number, val: string) {
    const d = val.replace(/\D/g, '').slice(-1);
    if (!d) return;
    const next = [...digits]; next[idx] = d;
    const joined = next.join('');
    onChange(joined);
    if (idx < 5) setTimeout(() => refs.current[idx + 1]?.focus(), 0);
    if (joined.length === 6) onComplete();
  }
  function handleBackspace(idx: number) {
    if (digits[idx]) { const next = [...digits]; next[idx] = ''; onChange(next.join('')); }
    else if (idx > 0) { const next = [...digits]; next[idx - 1] = ''; onChange(next.join('')); setTimeout(() => refs.current[idx - 1]?.focus(), 0); }
  }
  return (
    <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', marginVertical: 8 }}>
      {digits.map((digit, idx) => (
        <TextInput key={idx} ref={r => { refs.current[idx] = r; }}
          style={{ width: 44, height: 52, borderWidth: 2, borderColor: digit ? theme.color.accent : theme.color.border, borderRadius: 8, textAlign: 'center', fontSize: 22, fontWeight: '700', color: theme.color.text, backgroundColor: theme.color.surface }}
          value={digit} onChangeText={v => handleChange(idx, v)}
          onKeyPress={({ nativeEvent }) => { if (nativeEvent.key === 'Backspace') handleBackspace(idx); }}
          keyboardType="number-pad" maxLength={1} selectTextOnFocus caretHidden autoFocus={idx === 0} />
      ))}
    </View>
  );
}

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
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [step, setStep] = useState<'phone' | 'credential'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneValid = phone.replace(/\D/g, '').length === 10;

  function goToCredential() {
    if (!phoneValid) { setError('Enter a valid 10-digit mobile number'); return; }
    setError(null);
    setStep('credential');
  }

  async function login() {
    const cred = credential.trim();
    if (!cred) { setError('Enter your password or OTP'); return; }
    setBusy(true); setError(null);
    try {
      const { accessToken } = await api.login(phone.replace(/\D/g, '').slice(-10), cred, APP_TYPE);
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
              <View style={s.cc}><Text style={s.ccText}>🇮🇳  +91</Text></View>
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
            <Text style={s.label}>{mode === 'password' ? t.login.passwordLabel : t.login.otpCredLabel}</Text>
            <Text style={s.otpSub}>+91 {phone} · <Text style={s.changeLink} onPress={() => { setStep('phone'); setCredential(''); setError(null); }}>{t.login.changeNumber}</Text></Text>
            {mode === 'otp' ? (
              <AdminOtpBoxes value={credential} onChange={(v: string) => { setCredential(v); setError(null); }} onComplete={login} />
            ) : (
              <TextInput
                style={s.credInput}
                placeholder={t.login.passwordPlaceholder}
                placeholderTextColor={theme.color.textFaint}
                secureTextEntry
                value={credential}
                onChangeText={v => { setCredential(v); setError(null); }}
                autoFocus
                onSubmitEditing={login}
              />
            )}
            <Pressable
              style={[s.btn, (busy || !credential.trim()) && s.btnDim]}
              onPress={login}
              disabled={busy || !credential.trim()}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{t.login.signIn}</Text>}
            </Pressable>
            <Text style={s.toggleLink} onPress={() => { setMode(mode === 'password' ? 'otp' : 'password'); setCredential(''); setError(null); }}>
              {mode === 'password' ? t.login.useOtpInstead : t.login.usePasswordInstead}
            </Text>
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
  otpSub: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: -theme.space.xs },
  changeLink: { color: theme.color.accent, fontWeight: '700' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt },
  cc: { paddingHorizontal: theme.space.md, paddingVertical: 12, borderRightWidth: 1, borderRightColor: theme.color.borderStrong },
  ccText: { fontSize: theme.font.body, color: theme.color.text, fontWeight: '600' },
  phoneInput: { flex: 1, padding: theme.space.md, fontSize: theme.font.body, color: theme.color.text },
  credInput: { borderWidth: 1.5, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt, padding: theme.space.md, fontSize: theme.font.body, color: theme.color.text },
  toggleLink: { color: theme.color.accent, fontWeight: '700', fontSize: theme.font.small, textAlign: 'center' },
  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: theme.space.sm, marginVertical: theme.space.xs },
  otpBox: { width: 44, height: 52, borderWidth: 1.5, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md, fontSize: theme.font.h2, fontWeight: '800', color: theme.color.text, backgroundColor: theme.color.surfaceAlt, textAlign: 'center' },
  otpBoxFilled: { borderColor: theme.color.primary, backgroundColor: '#E6F4EC' },
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
