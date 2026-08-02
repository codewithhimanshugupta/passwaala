import { Platform, StyleSheet, View } from 'react-native';
import { theme } from '../theme';

/**
 * UpiQr — renders a UPI deep-link as a scannable QR. Native only — on web
 * react-native-svg isn't available and QRCode renders the raw URL string.
 * The "Pay now" button covers the web path.
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
  return null;
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
