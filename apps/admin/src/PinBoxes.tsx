import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from './theme';

/**
 * PinBoxes — a 4-digit PIN entry rendered as separate boxes (the same UX as the
 * OTP input), with auto-advance between boxes and backspace-to-previous. Calls
 * `onComplete(value)` as soon as the last digit is entered — passing the FINAL
 * value so callers never read stale state (a submit closure captured at render
 * time would otherwise hold the pre-last-digit value and mis-compare).
 *
 * Controlled: the parent holds the value string (0–length digits). Masked by
 * default; a plain-text show/hide toggle reveals the digits.
 *
 * Layout: an optional header row holds the `label` (left) and the show/hide
 * toggle (right); the boxes below spread edge-to-edge so the control lines up
 * with the full-width fields around it.
 */
export function PinBoxes({
  value,
  onChange,
  onComplete,
  autoFocus,
  mask = true,
  length = 4,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (value: string) => void;
  autoFocus?: boolean;
  mask?: boolean;
  length?: number;
  label?: string;
}) {
  const refs = useRef<Array<TextInput | null>>(Array(length).fill(null));
  const [revealed, setRevealed] = useState(false);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  function handleChange(idx: number, raw: string) {
    const d = raw.replace(/\D/g, '').slice(-1);
    if (!d) return;
    const next = [...digits];
    next[idx] = d;
    const joined = next.join('').slice(0, length);
    onChange(joined);
    if (idx < length - 1) {
      setTimeout(() => refs.current[idx + 1]?.focus(), 0);
    }
    // Pass the freshly-built value so the caller doesn't rely on stale state.
    if (joined.length === length) onComplete?.(joined);
  }

  function handleKeyPress(idx: number, key: string) {
    if (key !== 'Backspace') return;
    const next = [...digits];
    if (digits[idx]) {
      next[idx] = '';
      onChange(next.join(''));
    } else if (idx > 0) {
      next[idx - 1] = '';
      onChange(next.join(''));
      setTimeout(() => refs.current[idx - 1]?.focus(), 0);
    }
  }

  return (
    <View style={s.wrap}>
      {label || mask ? (
        <View style={s.header}>
          {label ? <Text style={s.label}>{label}</Text> : <View style={s.flex} />}
          {mask ? (
            <Pressable onPress={() => setRevealed((v) => !v)} hitSlop={8}>
              <Text style={s.eyeText}>{revealed ? 'Hide' : 'Show'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={s.row}>
        {digits.map((digit, idx) => (
          <TextInput
            key={idx}
            ref={(r) => { refs.current[idx] = r; }}
            style={[s.box, digit ? s.boxFilled : null]}
            value={digit}
            onChangeText={(v) => handleChange(idx, v)}
            onKeyPress={({ nativeEvent }) => handleKeyPress(idx, nativeEvent.key)}
            keyboardType="number-pad"
            maxLength={1}
            secureTextEntry={mask && !revealed}
            selectTextOnFocus
            autoFocus={autoFocus && idx === 0}
          />
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: theme.space.sm },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  row: { flexDirection: 'row', gap: theme.space.sm, justifyContent: 'center' },
  box: {
    width: 60,
    height: 60,
    borderWidth: 2,
    borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.md,
    fontSize: theme.font.h1,
    fontWeight: '800',
    color: theme.color.text,
    backgroundColor: theme.color.surfaceAlt,
    textAlign: 'center',
  },
  boxFilled: {
    borderColor: theme.color.accent,
    backgroundColor: theme.color.infoBg,
  },
  eyeText: { fontSize: theme.font.small, color: theme.color.accent, fontWeight: '700' },
});
