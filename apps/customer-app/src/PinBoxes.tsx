import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from './theme';

/**
 * PinBoxes — a fixed-length PIN entry rendered as separate boxes (OTP-style),
 * with auto-advance, backspace-to-previous, and paste support. Calls
 * `onComplete(value)` when the last digit is entered — passing the FINAL value
 * so callers never read stale state.
 *
 * Layout: an optional header row holds the `label` (left) and the show/hide
 * toggle (right); the boxes below spread edge-to-edge so the control lines up
 * with the full-width fields around it. Masked by default.
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
    const cleaned = raw.replace(/\D/g, '');
    if (!cleaned) return;
    if (cleaned.length > 1) {
      const pasted = cleaned.slice(0, length);
      onChange(pasted);
      const target = Math.min(pasted.length, length - 1);
      setTimeout(() => refs.current[target]?.focus(), 0);
      if (pasted.length === length) onComplete?.(pasted);
      return;
    }
    const next = [...digits];
    next[idx] = cleaned.slice(-1);
    const joined = next.join('').slice(0, length);
    onChange(joined);
    if (idx < length - 1) setTimeout(() => refs.current[idx + 1]?.focus(), 0);
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
    <View style={styles.wrap}>
      {label || mask ? (
        <View style={styles.header}>
          {label ? <Text style={styles.label}>{label}</Text> : <View style={styles.flex} />}
          {mask ? (
            <Pressable onPress={() => setRevealed((v) => !v)} hitSlop={8}>
              <Text style={styles.eyeText}>{revealed ? 'Hide' : 'Show'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={styles.row}>
        {digits.map((digit, idx) => (
          <TextInput
            key={idx}
            ref={(r) => { refs.current[idx] = r; }}
            style={[styles.box, digit ? styles.boxFilled : null]}
            value={digit}
            onChangeText={(v) => handleChange(idx, v)}
            onKeyPress={({ nativeEvent }) => handleKeyPress(idx, nativeEvent.key)}
            keyboardType="number-pad"
            maxLength={length}
            secureTextEntry={mask && !revealed}
            selectTextOnFocus
            autoFocus={autoFocus && idx === 0}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: theme.font.small, fontWeight: theme.weight.semibold, color: theme.color.textMuted },
  eyeText: { fontSize: theme.font.small, color: theme.color.primary, fontWeight: theme.weight.semibold },
  row: { flexDirection: 'row', gap: theme.space.sm, justifyContent: 'center' },
  box: {
    width: 60,
    height: 60,
    borderWidth: 2,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    fontSize: theme.font.h1,
    fontWeight: '800',
    color: theme.color.text,
    backgroundColor: theme.color.surface,
    textAlign: 'center',
  },
  boxFilled: {
    borderColor: theme.color.primary,
    backgroundColor: theme.color.primaryLight,
  },
});
