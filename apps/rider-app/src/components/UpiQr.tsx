import { Platform, StyleSheet, View } from 'react-native';
import { theme } from '../theme';

/**
 * UpiQr — renders a UPI deep-link as a scannable QR.
 * Native: react-native-qrcode-svg.
 * Web: self-contained iframe using qrcodejs (CDN) — no broken-image risk.
 */
export function UpiQr({ link, size = 180 }: { link: string; size?: number }) {
  if (Platform.OS === 'web') {
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;background:#fff}</style>
</head><body>
<div id="qr"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>
new QRCode(document.getElementById("qr"),{text:${JSON.stringify(link)},width:${size - 4},height:${size - 4},correctLevel:QRCode.CorrectLevel.M});
</script>
</body></html>`;

    const Iframe = 'iframe' as unknown as React.ComponentType<Record<string, unknown>>;
    return (
      <View style={[styles.frame, { width: size + 16, height: size + 16 }]}>
        <Iframe
          srcDoc={doc}
          title="UPI QR"
          style={{ border: '0', width: size, height: size, display: 'block' }}
          sandbox="allow-scripts"
        />
      </View>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const QRCode = require('react-native-qrcode-svg').default;
  return (
    <View style={styles.frame}>
      <QRCode value={link} size={size} backgroundColor="#FFFFFF" color="#000000" />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    padding: 8,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
