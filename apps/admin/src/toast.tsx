/**
 * Global toast — one small, friendly popup for app-wide messages (mostly API
 * errors). A module-level pub/sub lets ANY code (even the API client's onError
 * hook in api.ts) trigger a toast without prop-drilling.
 *
 * Mount <ToastHost /> once at the app root. Call notifyError()/notifySuccess()/
 * notifyInfo() from anywhere. Run raw errors through friendlyMessage() from
 * @passwaala/api-client before calling.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from './theme';

export type ToastTone = 'error' | 'success' | 'info';
type Toast = { id: number; message: string; tone: ToastTone };

let counter = 0;
let listener: ((t: Toast) => void) | null = null;

function emit(message: string, tone: ToastTone): void {
  const msg = (message ?? '').trim();
  if (!msg) return;
  listener?.({ id: ++counter, message: msg, tone });
}

/** Show a red error popup. Pass an already-friendly message. */
export function notifyError(message: string): void {
  emit(message, 'error');
}
/** Show a green success popup. */
export function notifySuccess(message: string): void {
  emit(message, 'success');
}
/** Show a neutral info popup. */
export function notifyInfo(message: string): void {
  emit(message, 'info');
}

const TONE = {
  error: { bg: theme.color.critical, fg: '#FFFFFF' },
  success: { bg: theme.color.good, fg: '#FFFFFF' },
  info: { bg: theme.color.text, fg: '#FFFFFF' },
} as const;

/** Mount once at the app root. Renders the active toast with a slide/fade + auto-dismiss. */
export function ToastHost(): React.ReactElement | null {
  const [toast, setToast] = useState<Toast | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    listener = (t) => setToast(t);
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: Platform.OS !== 'web' }).start();
    const ms = Math.min(6000, 3200 + toast.message.length * 40);
    hideTimer.current = setTimeout(dismiss, ms);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [toast?.id]);

  function dismiss(): void {
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start(
      ({ finished }) => {
        if (finished) setToast(null);
      },
    );
  }

  if (!toast) return null;
  const tone = TONE[toast.tone];
  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <Animated.View
        style={{
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
          width: '100%',
          maxWidth: 480,
        }}
      >
        <Pressable onPress={dismiss} style={[styles.toast, { backgroundColor: tone.bg }]}>
          <Text style={[styles.text, { color: tone.fg }]} numberOfLines={3}>
            {toast.message}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 16,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: theme.space.lg,
    zIndex: 9999,
  },
  toast: {
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.lg,
    ...shadowElevated(),
  },
  text: {
    fontSize: theme.font.body,
    fontWeight: '600',
    textAlign: 'center',
  },
});

function shadowElevated() {
  return Platform.select({
    web: { boxShadow: '0 6px 20px rgba(0,0,0,0.18)' } as object,
    default: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 12,
      elevation: 6,
    },
  }) as object;
}
