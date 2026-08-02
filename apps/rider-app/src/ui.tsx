import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useRef } from 'react';
import { theme } from './theme';

/**
 * Reusable UI primitives for the rider app: Screen, Card, Button, Badge,
 * Chip, Field, SectionTitle, Divider, Banner. Built on the design tokens so the
 * whole partner app reads as one system (cards, shadows, badges, chips).
 */

/* --------------------------------- Screen --------------------------------- */

export function Screen({
  children,
  scroll = true,
  contentStyle,
  refreshControl,
}: {
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement;
}) {
  if (!scroll) {
    return <View style={[styles.screen, contentStyle]}>{children}</View>;
  }
  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={[styles.screenContent, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  );
}

/* ---------------------------------- Card ---------------------------------- */

export function Card({
  children,
  style,
  elevated = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
}) {
  return (
    <View style={[styles.card, elevated && theme.shadow.sm, style]}>{children}</View>
  );
}

/* --------------------------------- Button --------------------------------- */

type ButtonVariant = 'primary' | 'accent' | 'danger' | 'outline' | 'ghost';

export function Button({
  label,
  onPress,
  busy = false,
  disabled = false,
  variant = 'accent',
  small = false,
  style,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || busy;
  const palette = buttonPalette(variant);
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: palette.bg, borderColor: palette.border },
        palette.bordered && styles.btnBordered,
        (pressed || isDisabled) && styles.btnDim,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={palette.fg} size="small" />
      ) : (
        <Text
          style={[styles.btnText, small && styles.btnTextSmall, { color: palette.fg }]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function buttonPalette(variant: ButtonVariant): {
  bg: string;
  fg: string;
  border: string;
  bordered: boolean;
} {
  switch (variant) {
    case 'primary':
      return { bg: theme.color.primary, fg: theme.color.white, border: 'transparent', bordered: false };
    case 'danger':
      return { bg: theme.color.danger, fg: theme.color.white, border: 'transparent', bordered: false };
    case 'outline':
      return { bg: 'transparent', fg: theme.color.accent, border: theme.color.borderStrong, bordered: true };
    case 'ghost':
      return { bg: theme.color.surfaceAlt, fg: theme.color.text, border: 'transparent', bordered: false };
    case 'accent':
    default:
      return { bg: theme.color.accent, fg: theme.color.white, border: 'transparent', bordered: false };
  }
}

/* --------------------------------- Badge ---------------------------------- */

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const palette = badgePalette(tone);
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.badgeText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

function badgePalette(tone: BadgeTone): { bg: string; fg: string } {
  switch (tone) {
    case 'success':
      return { bg: theme.color.successSoft, fg: theme.color.success };
    case 'warning':
      return { bg: theme.color.warningSoft, fg: theme.color.warning };
    case 'danger':
      return { bg: theme.color.dangerSoft, fg: theme.color.danger };
    case 'info':
    case 'accent':
      return { bg: theme.color.accentSoft, fg: theme.color.accent };
    case 'neutral':
    default:
      return { bg: theme.color.surfaceAlt, fg: theme.color.textMuted };
  }
}

/* ---------------------------------- Chip ---------------------------------- */

export function Chip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.btnDim,
      ]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

/* ---------------------------------- Field --------------------------------- */

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  maxLength,
  autoFocus,
  hint,
  multiline,
}: {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad' | 'phone-pad' | 'decimal-pad' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  maxLength?: number;
  autoFocus?: boolean;
  hint?: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.textFaint}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
        autoFocus={autoFocus}
        multiline={multiline}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

/* ----------------------------- Misc text bits ----------------------------- */

export function SectionTitle({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.sectionTitle, style]}>{children}</Text>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

export type BannerTone = 'info' | 'warning' | 'success' | 'danger';

export function Banner({
  tone = 'info',
  title,
  message,
  action,
}: {
  tone?: BannerTone;
  title?: string;
  message: string;
  action?: ReactNode;
}) {
  const palette = bannerPalette(tone);
  return (
    <View style={[styles.banner, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <View style={styles.bannerBody}>
        {title ? <Text style={[styles.bannerTitle, { color: palette.fg }]}>{title}</Text> : null}
        <Text style={[styles.bannerText, { color: palette.fg }]}>{message}</Text>
      </View>
      {action}
    </View>
  );
}

function bannerPalette(tone: BannerTone): { bg: string; fg: string; border: string } {
  switch (tone) {
    case 'warning':
      return { bg: theme.color.warningSoft, fg: theme.color.warning, border: '#F3D9B5' };
    case 'success':
      return { bg: theme.color.successSoft, fg: theme.color.primaryDark, border: '#BFE3CE' };
    case 'danger':
      return { bg: theme.color.dangerSoft, fg: theme.color.danger, border: '#F5C6C6' };
    case 'info':
    default:
      return { bg: theme.color.accentSoft, fg: theme.color.accentDark, border: '#F8D4B4' };
  }
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={styles.errorText}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.bg },
  screenScroll: { flex: 1, backgroundColor: theme.color.bg },
  screenContent: { padding: theme.space.lg, gap: theme.space.md, paddingBottom: theme.space.xxl },

  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
  },

  btn: {
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  btnSmall: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.md, minHeight: 36 },
  btnBordered: { borderWidth: 1 },
  btnDim: { opacity: 0.55 },
  btnText: { fontWeight: '700', fontSize: theme.font.body },
  btnTextSmall: { fontSize: theme.font.small },

  badge: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.sm + 2,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: theme.font.tiny, fontWeight: '800', letterSpacing: 0.4 },

  chip: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  chipSelected: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  chipText: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  chipTextSelected: { color: theme.color.white },

  field: { gap: theme.space.xs },
  fieldLabel: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.text },
  input: {
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.md,
    fontSize: theme.font.body,
    color: theme.color.text,
    backgroundColor: theme.color.surface,
  },
  inputMultiline: { minHeight: 76, textAlignVertical: 'top' },
  fieldHint: { fontSize: theme.font.tiny, color: theme.color.textFaint },

  sectionTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  divider: { height: 1, backgroundColor: theme.color.border, marginVertical: theme.space.sm },

  banner: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    padding: theme.space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
  },
  bannerBody: { flex: 1, gap: 2 },
  bannerTitle: { fontWeight: '800', fontSize: theme.font.small },
  bannerText: { fontSize: theme.font.small, lineHeight: 19 },

  errorText: { color: theme.color.danger, fontSize: theme.font.small, fontWeight: '600' },
});

/* --------------------------------- OtpBoxes -------------------------------- */

/**
 * OtpBoxes — n individual single-character boxes (default 4, or 6 for login).
 * Each box auto-advances focus on input and retreats on backspace, matching the
 * login OTP experience. `value` is the full code string; `onChange` fires on
 * every change.
 */
export function OtpBoxes({
  length = 4,
  value,
  onChange,
  onComplete,
  autoFocus = true,
}: {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (code: string) => void;
  autoFocus?: boolean;
}) {
  const refs = useRef<Array<TextInput | null>>(Array(length).fill(null));
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  function handleChange(idx: number, val: string) {
    const d = val.replace(/\D/g, '').slice(0, length - idx);
    if (!d) return;
    const next = [...digits];
    for (let i = 0; i < d.length && idx + i < length; i++) next[idx + i] = d[i];
    const joined = next.join('');
    onChange(joined);
    const focus = Math.min(idx + d.length, length - 1);
    if (!next[focus]) setTimeout(() => refs.current[focus]?.focus(), 0);
    if (joined.length === length) onComplete?.(joined);
  }

  function handleBackspace(idx: number) {
    if (digits[idx]) {
      const next = [...digits];
      next[idx] = '';
      onChange(next.join(''));
    } else if (idx > 0) {
      const next = [...digits];
      next[idx - 1] = '';
      onChange(next.join(''));
      setTimeout(() => refs.current[idx - 1]?.focus(), 0);
    }
  }

  return (
    <View style={otpStyles.row}>
      {digits.map((digit, idx) => (
        <TextInput
          key={idx}
          ref={(r) => { refs.current[idx] = r; }}
          style={[otpStyles.box, digit ? otpStyles.boxFilled : null]}
          value={digit}
          onChangeText={(v) => handleChange(idx, v)}
          onKeyPress={({ nativeEvent }) => { if (nativeEvent.key === 'Backspace') handleBackspace(idx); }}
          keyboardType="number-pad"
          maxLength={1}
          selectTextOnFocus
          caretHidden
          textAlign="center"
          autoFocus={autoFocus && idx === 0}
        />
      ))}
    </View>
  );
}

const otpStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: theme.space.sm },
  box: {
    width: 52, height: 60,
    borderWidth: 2, borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.md,
    fontSize: theme.font.h1, fontWeight: '900',
    color: theme.color.text,
    backgroundColor: theme.color.surface,
    textAlign: 'center',
  },
  boxFilled: { borderColor: theme.color.accent, backgroundColor: theme.color.accentSoft },
});
