import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { theme } from './theme';

/**
 * StripedProgressBar — an indeterminate progress bar with diagonal stripes that
 * scroll continuously, signalling "working…" during a slow operation (e.g. order
 * placement, which can take a few seconds on the current server). Colour defaults
 * to the app's primary theme colour.
 *
 * Web-only stripe texture via a CSS repeating-linear-gradient on the animated
 * layer; on native it degrades to a solid animated fill (still clearly moving).
 */
export function StripedProgressBar({
  color = theme.color.primary,
  height = 12,
}: {
  color?: string;
  height?: number;
}) {
  const shift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shift, {
        toValue: 1,
        duration: 700,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [shift]);

  // Slide the striped layer left by one stripe period, looping seamlessly.
  const translateX = shift.interpolate({ inputRange: [0, 1], outputRange: [0, -32] });
  const stripeStyle =
    typeof document !== 'undefined'
      ? {
          backgroundImage: `repeating-linear-gradient(45deg, ${color} 0, ${color} 12px, ${withAlpha(color, 0.6)} 12px, ${withAlpha(color, 0.6)} 24px)`,
        }
      : { backgroundColor: color };

  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <Animated.View
        style={[
          styles.fill,
          { transform: [{ translateX }], width: '130%' },
          stripeStyle as object,
        ]}
      />
    </View>
  );
}

/** rgba() from a #rrggbb hex + alpha (for the lighter stripe band). */
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    backgroundColor: theme.color.surfaceAlt,
    overflow: 'hidden',
  },
  fill: { height: '100%' },
});
