import { useEffect, useState } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { theme } from '../theme';

/**
 * UpiQr — renders a UPI deep-link as a scannable QR on BOTH native and web.
 *  - Native: react-native-qrcode-svg (react-native-svg).
 *  - Web:    the pure-JS `qrcode` package generates a PNG data-URL rendered via
 *            <Image>. This is the ONLY reliable payment path on desktop (no UPI
 *            app to deep-link into) and on iOS Safari (which rejects Android
 *            `intent://` URLs) — the customer scans it with any phone UPI app.
 */
export function UpiQr({ link, size = 200 }: { link: string; size?: number }) {
  if (Platform.OS !== 'web') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const QRCode = require('react-native-qrcode-svg').default;
    return (
      <View style={styles.frame}>
        <QRCode value={link} size={size} backgroundColor="#FFFFFF" color="#000000" />
      </View>
    );
  }
  return <WebQr link={link} size={size} />;
}

/** Web QR — generate a PNG data-URL from the deep-link (Metro resolves `qrcode`
 *  to its browser build, which uses a <canvas>, via the package's "browser"
 *  field). Renders nothing until the data-URL is ready. */
function WebQr({ link, size }: { link: string; size: number }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const QRCode = require('qrcode');
    QRCode.toDataURL(link, { width: size, margin: 1 })
      .then((u: string) => { if (alive) setUri(u); })
      .catch(() => { if (alive) setUri(null); });
    return () => { alive = false; };
  }, [link, size]);
  if (!uri) return null;
  return (
    <View style={styles.frame}>
      <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
});
