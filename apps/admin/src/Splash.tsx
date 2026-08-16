import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

/**
 * Splash — branded startup screen shown on every launch: the "NearBaz." wordmark
 * centered on a dark backdrop with a thin animated progress bar that fills as the
 * app boots, then fades out. Admin has no bundled logo asset, so this is the
 * wordmark-only variant. Purely cosmetic — the app mounts behind it.
 */
const BG = '#0B0F14';
const ORANGE = '#F2711C';

export function Splash({ onDone }: { onDone: () => void }) {
  const { width } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 1300,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start(() => {
      Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => onDone());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fillWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const wordSize = Math.min(56, Math.round(width * 0.08));
  const barWidth = Math.min(280, Math.round(width * 0.32));

  return (
    <Animated.View style={[styles.root, { opacity: fade }]} pointerEvents="none">
      <View style={styles.center}>
        <Text style={[styles.word, { fontSize: wordSize }]}>
          NearBaz<Text style={styles.dot}>.</Text>
        </Text>
        <View style={[styles.track, { width: barWidth }]}>
          <Animated.View style={[styles.fill, { width: fillWidth }]} />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  word: { color: '#FFFFFF', fontWeight: '800', letterSpacing: 0.5 },
  dot: { color: ORANGE },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginTop: 24,
    overflow: 'hidden',
  },
  fill: { height: 3, borderRadius: 2, backgroundColor: ORANGE },
});
