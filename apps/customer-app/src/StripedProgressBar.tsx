import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { theme } from './theme';

/**
 * FillingProgressBar — animates a bar filling left-to-right over `duration` ms,
 * then holds full while the operation completes. Signals "placing your order…"
 * during slow server operations.
 */
export function StripedProgressBar({
  color = theme.color.primary,
  height = 12,
  duration = 3500,
}: {
  color?: string;
  height?: number;
  duration?: number;
}) {
  const fill = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fill to 90% over `duration`, then creep slowly to ~97% — never reaches 100%
    // until the operation actually completes so it never "false-finishes".
    const seq = Animated.sequence([
      Animated.timing(fill, {
        toValue: 0.9,
        duration,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(fill, {
        toValue: 0.97,
        duration: 4000,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    ]);
    seq.start();
    return () => seq.stop();
  }, [fill, duration]);

  const width = fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <Animated.View style={[styles.fill, { width, backgroundColor: color, borderRadius: height / 2 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    backgroundColor: theme.color.surfaceAlt,
    overflow: 'hidden',
  },
  fill: { height: '100%' },
});
