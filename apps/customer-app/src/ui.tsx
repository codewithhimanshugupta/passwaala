/**
 * Reusable UI primitives for the PassWaala customer app. Small, composable, and
 * styled from the shared theme tokens so every screen reads as one system.
 */
import type { ReactNode } from 'react';
import { useRef } from 'react';
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
import { shadow, theme } from './theme';
import { useLang } from './i18n/LanguageContext';

/* ------------------------------------------------------------------ Screen */

/** Full-height screen wrapper, centered to a mobile-width column on web. */
export function Screen({
  children,
  scroll = false,
  contentStyle,
  background = theme.color.surface,
}: {
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  background?: string;
}) {
  if (scroll) {
    return (
      <View style={[s.screen, { backgroundColor: background }]}>
        <ScrollView
          style={s.flex}
          contentContainerStyle={[s.scrollInner, contentStyle]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={[s.screen, { backgroundColor: background }]}>
      <View style={[s.flex, s.column, contentStyle]}>{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ Button */

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  busy = false,
  disabled = false,
  variant = 'primary',
  size = 'md',
  icon,
  style,
  fullWidth = true,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
  style?: StyleProp<ViewStyle>;
  fullWidth?: boolean;
}) {
  const isDisabled = disabled || busy;
  const v = buttonVariants[variant];
  const sz = buttonSizes[size];
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        s.btnBase,
        { backgroundColor: v.bg, borderColor: v.border },
        v.border !== 'transparent' && s.btnBordered,
        { paddingVertical: sz.py, paddingHorizontal: sz.px },
        fullWidth && s.flexShrink,
        pressed && !isDisabled && s.pressed,
        isDisabled && s.btnDisabled,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <Text style={[s.btnText, { color: v.fg, fontSize: sz.font }]}>
          {icon ? `${icon}  ` : ''}
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: theme.color.primary, fg: theme.color.onPrimary, border: 'transparent' },
  secondary: { bg: theme.color.primaryLight, fg: theme.color.primaryDark, border: 'transparent' },
  outline: { bg: theme.color.bg, fg: theme.color.primary, border: theme.color.primary },
  ghost: { bg: 'transparent', fg: theme.color.primary, border: 'transparent' },
  danger: { bg: theme.color.dangerLight, fg: theme.color.danger, border: 'transparent' },
};

const buttonSizes = {
  sm: { py: 8, px: 14, font: theme.font.small },
  md: { py: 13, px: 18, font: theme.font.body },
  lg: { py: 16, px: 22, font: theme.font.h3 },
};

/* -------------------------------------------------------------------- Card */

export function Card({
  children,
  style,
  onPress,
  padded = true,
  elevation = 'sm',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  padded?: boolean;
  elevation?: 'none' | 'sm' | 'md' | 'lg';
}) {
  const elev = elevation === 'none' ? undefined : shadow[elevation];
  const content = (
    <View style={[s.card, elev, padded && s.cardPad, style]}>{children}</View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed && s.pressed}>
        {content}
      </Pressable>
    );
  }
  return content;
}

/* -------------------------------------------------------------- Coin chip */

/**
 * CoinChip — the PassWaala Coins rewards pill. Golden background with a coin
 * glyph so it reads as a reward, not plain text. `size` picks label scale;
 * `onLight` uses a solid gold fill for light surfaces, otherwise a translucent
 * gold suited to dark/brand backgrounds.
 */
export function CoinChip({
  balance,
  showUnit = true,
  size = 'md',
  onLight = false,
  style,
}: {
  balance: number;
  showUnit?: boolean;
  size?: 'sm' | 'md';
  onLight?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const label = showUnit ? `${balance} PassWaala Coins` : `${balance}`;
  return (
    <View
      style={[
        s.coinChip,
        onLight ? s.coinChipLight : s.coinChipDark,
        size === 'sm' && s.coinChipSm,
        style,
      ]}
    >
      <Text style={[s.coinText, onLight ? s.coinTextLight : s.coinTextDark, size === 'sm' && s.coinTextSm]}>
        {label}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------- Badge */

type BadgeTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'accent';

export function Badge({
  label,
  tone = 'neutral',
  style,
  textStyle,
}: {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const t = badgeTones[tone];
  return (
    <View style={[s.badge, { backgroundColor: t.bg }, style]}>
      <Text style={[s.badgeText, { color: t.fg }, textStyle]}>{label}</Text>
    </View>
  );
}

const badgeTones: Record<BadgeTone, { bg: string; fg: string }> = {
  success: { bg: theme.color.successLight, fg: theme.color.success },
  danger: { bg: theme.color.dangerLight, fg: theme.color.danger },
  warning: { bg: theme.color.warningLight, fg: theme.color.warning },
  info: { bg: theme.color.infoLight, fg: theme.color.info },
  neutral: { bg: theme.color.surfaceAlt, fg: theme.color.textMuted },
  accent: { bg: theme.color.accentLight, fg: theme.color.warning },
};

/* ------------------------------------------------------------------ States */

export function Loading({ label }: { label?: string }) {
  return (
    <View style={s.centered}>
      <ActivityIndicator color={theme.color.primary} size="large" />
      {label ? <Text style={s.stateMuted}>{label}</Text> : null}
    </View>
  );
}

/** A single grey placeholder block (skeleton). Width can be a % or number. */
export function SkeletonBlock({
  width = '100%',
  height = 16,
  radius = 8,
  style,
}: {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: object;
}) {
  return (
    <View
      style={[
        { width: width as never, height, borderRadius: radius, backgroundColor: theme.color.surfaceAlt },
        style,
      ]}
    />
  );
}

/**
 * StorefrontSkeleton — placeholder scaffold shown while a shop's catalog loads,
 * instead of a bare spinner: a banner block + a few product-row skeletons so the
 * screen has shape immediately (feels faster on the slow tier).
 */
export function StorefrontSkeleton() {
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <SkeletonBlock width="100%" height={160} radius={0} />
      <View style={{ padding: theme.space.lg, gap: theme.space.md }}>
        <SkeletonBlock width="55%" height={22} />
        <SkeletonBlock width="35%" height={14} />
        <SkeletonBlock width="100%" height={44} radius={theme.radius.md} />
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={s.skelRow}>
            <SkeletonBlock width={84} height={84} radius={12} />
            <View style={{ flex: 1, gap: 8 }}>
              <SkeletonBlock width="70%" height={16} />
              <SkeletonBlock width="40%" height={14} />
              <SkeletonBlock width={90} height={30} radius={theme.radius.md} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const { t } = useLang();
  return (
    <View style={s.centered}>
      <Text style={s.stateTitle}>{t.common.somethingWentWrong}</Text>
      <Text style={s.stateMuted}>{message}</Text>
      {onRetry ? (
        <View style={s.stateAction}>
          <Button label={t.common.tryAgain} onPress={onRetry} variant="outline" fullWidth={false} />
        </View>
      ) : null}
    </View>
  );
}

export function EmptyState({
  emoji,
  title,
  subtitle,
  action,
}: {
  emoji?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <View style={s.centered}>
      {emoji ? <Text style={s.stateEmoji}>{emoji}</Text> : null}
      <Text style={s.stateTitle}>{title}</Text>
      {subtitle ? <Text style={s.stateMuted}>{subtitle}</Text> : null}
      {action ? <View style={s.stateAction}>{action}</View> : null}
    </View>
  );
}

/* ----------------------------------------------------------- Star rating */

export function Stars({ rating, size = theme.font.small }: { rating: number; size?: number }) {
  const full = Math.round(rating);
  return (
    <View style={s.starsRow}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Text key={n} style={[s.starGlyph, { fontSize: size }, n <= full ? s.starFilled : s.starEmpty]}>
          {n <= full ? '★' : '☆'}
        </Text>
      ))}
      <Text style={[s.starsValue, { fontSize: size }]}>{rating.toFixed(1)}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ Divider */

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[s.divider, style]} />;
}

/* ------------------------------------------------------------------ styles */

const s = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { alignSelf: 'stretch' },
  column: { width: '100%' },
  screen: { flex: 1, width: '100%', maxWidth: theme.maxContentWidth, alignSelf: 'center' },
  scrollInner: { paddingBottom: theme.space.xl },

  pressed: { opacity: 0.75 },

  btnBase: {
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnBordered: { borderWidth: 1.5 },
  btnText: { fontWeight: theme.weight.bold, letterSpacing: 0.2 },
  btnDisabled: { opacity: 0.5 },

  card: {
    backgroundColor: theme.color.card,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
  },
  cardPad: { padding: theme.space.lg },

  badge: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: theme.font.tiny, fontWeight: theme.weight.bold, letterSpacing: 0.3 },

  coinChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: theme.space.md,
    paddingVertical: 7,
    borderRadius: theme.radius.pill,
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  coinChipSm: { paddingHorizontal: theme.space.sm, paddingVertical: 4, gap: 4 },
  // Solid golden fill for light surfaces (cards / white bg).
  coinChipLight: { backgroundColor: '#FFF7E0', borderColor: '#F59E0B' },
  // Translucent gold for dark / brand backgrounds (e.g. the green profile hero).
  coinChipDark: { backgroundColor: 'rgba(245, 158, 11, 0.22)', borderColor: '#FFD700' },
  coinText: {
    fontSize: theme.font.small,
    fontWeight: theme.weight.heavy,
    letterSpacing: 0.2,
  },
  coinTextLight: { color: '#B45309' },
  coinTextDark: { color: '#FFE9A8' },
  coinTextSm: { fontSize: theme.font.tiny },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space.xl,
    gap: theme.space.sm,
  },
  stateEmoji: { fontSize: 44, marginBottom: theme.space.xs },
  stateTitle: { fontSize: theme.font.h3, fontWeight: theme.weight.bold, color: theme.color.text },
  stateMuted: { fontSize: theme.font.body, color: theme.color.textMuted, textAlign: 'center' },
  stateAction: { marginTop: theme.space.md },
  skelRow: { flexDirection: 'row', gap: theme.space.md, alignItems: 'center' },

  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  starGlyph: { fontWeight: theme.weight.bold },
  starFilled: { color: theme.color.star },
  starEmpty: { color: theme.color.border },
  starsValue: { color: theme.color.text, fontWeight: theme.weight.semibold, marginLeft: 4 },

  divider: { height: 1, backgroundColor: theme.color.border, width: '100%' },
});

export function OtpBoxes({
  length = 4,
  value,
  onChange,
  autoFocus = true,
}: {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const refs = useRef<Array<TextInput | null>>(Array(length).fill(null));
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  function handleChange(idx: number, val: string) {
    const d = val.replace(/\D/g, '').slice(0, length - idx);
    if (!d) return;
    const next = [...digits];
    for (let i = 0; i < d.length && idx + i < length; i++) next[idx + i] = d[i];
    onChange(next.join(''));
    const focus = Math.min(idx + d.length, length - 1);
    if (!next[focus]) setTimeout(() => refs.current[focus]?.focus(), 0);
  }

  function handleBackspace(idx: number) {
    if (digits[idx]) {
      const next = [...digits]; next[idx] = ''; onChange(next.join(''));
    } else if (idx > 0) {
      const next = [...digits]; next[idx - 1] = ''; onChange(next.join(''));
      setTimeout(() => refs.current[idx - 1]?.focus(), 0);
    }
  }

  return (
    <View style={otpSt.row}>
      {digits.map((digit, idx) => (
        <TextInput
          key={idx}
          ref={(r) => { refs.current[idx] = r; }}
          style={[otpSt.box, digit ? otpSt.boxFilled : null]}
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

const otpSt = StyleSheet.create({
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
  boxFilled: { borderColor: theme.color.primary, backgroundColor: theme.color.primaryLight },
});
