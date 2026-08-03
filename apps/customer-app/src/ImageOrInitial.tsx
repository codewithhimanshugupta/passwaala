import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle, type ImageStyle } from 'react-native';
import { theme } from './theme';

/**
 * ImageOrInitial — renders a real image if `uri` is present, otherwise a clean
 * colored card showing the name's initials (NO SVG placeholder, no fake image).
 * Used for shop banners/logos and product thumbnails so "no image = tidy text
 * card" per the product design.
 */
function initials(name: string): string {
  return (name || '?')
    .trim()
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('') || '?';
}

/** Deterministic soft background colour from the name (stable per shop/product). */
function tintFor(name: string): string {
  const tints = ['#E6F4EC', '#EAECFB', '#FDF3E7', '#FDECEC', '#E7F1FD', '#F3E8FD', '#E8F8F5'];
  const code = [...(name || '?')].reduce((n, c) => n + c.charCodeAt(0), 0);
  return tints[code % tints.length];
}

export function ImageOrInitial({
  uri,
  name,
  style,
  rounded,
  textStyle,
}: {
  uri: string | null | undefined;
  name: string;
  style: StyleProp<ImageStyle> & StyleProp<ViewStyle>;
  rounded?: boolean;
  textStyle?: StyleProp<{ fontSize?: number }>;
}) {
  if (uri) {
    return <Image source={{ uri }} style={style} />;
  }
  return (
    <View
      style={[
        style,
        styles.fallback,
        { backgroundColor: tintFor(name) },
        rounded ? styles.round : null,
      ]}
    >
      <Text style={[styles.initials, textStyle]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  round: { borderRadius: 999 },
  initials: { color: theme.color.primary, fontWeight: '900', fontSize: 22 },
});
