/**
 * UpiQrScanner — scan a UPI QR code and extract the VPA.
 *
 * Web-only implementation (this app is Expo web).
 * Strategy:
 *   1. Opens a file picker with capture="environment" (shows camera on mobile,
 *      file picker on desktop).
 *   2. Reads the image via BarcodeDetector API (Chrome/Edge/Android WebView) or
 *      falls back to drawing on a canvas and scanning with a pure-JS ZXing WASM
 *      via a dynamic import of @zxing/browser — but since we don't want a new dep
 *      we do the BarcodeDetector path and show a manual-entry fallback on browsers
 *      that don't support it.
 *   3. Parses the scanned string as a UPI deep-link or bare VPA and calls onScan.
 *
 * UPI QR format:
 *   upi://pay?pa=merchant@bank&pn=Name&...   → extract `pa` param
 *   OR a bare VPA string like merchant@bank
 */
import { useRef } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from '../theme';

interface Props {
  onScan: (vpa: string) => void;
  onError?: (msg: string) => void;
}

function extractVpa(raw: string): string | null {
  const trimmed = raw.trim();
  // upi://pay?pa=vpa&... or upi://pay?pa=vpa
  if (trimmed.toLowerCase().startsWith('upi://')) {
    try {
      // URLSearchParams needs a query string — strip the scheme+path first
      const qs = trimmed.includes('?') ? trimmed.split('?')[1] : '';
      const params = new URLSearchParams(qs);
      const pa = params.get('pa');
      if (pa) return pa.trim();
    } catch { /* fall through */ }
  }
  // Bare VPA: contains @ but no spaces
  if (trimmed.includes('@') && !trimmed.includes(' ')) return trimmed;
  return null;
}

async function decodeImage(file: File): Promise<string | null> {
  // BarcodeDetector is available in Chrome 83+, Edge, Android WebView
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
      const bitmap = await createImageBitmap(file);
      const results = await detector.detect(bitmap);
      bitmap.close();
      if (results.length > 0) return results[0].rawValue as string;
    } catch { /* fall through to null */ }
  }
  return null;
}

export function UpiQrScanner({ onScan, onError }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleClick() {
    if (inputRef.current) inputRef.current.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!inputRef.current) return;
    inputRef.current.value = ''; // reset so same file can be re-selected
    if (!file) return;

    const raw = await decodeImage(file);
    if (!raw) {
      onError?.('Could not read a QR code from this image. Try a clearer photo.');
      return;
    }
    const vpa = extractVpa(raw);
    if (!vpa) {
      onError?.(`QR scanned but no UPI ID found. Raw: "${raw.slice(0, 60)}"`);
      return;
    }
    onScan(vpa);
  }

  return (
    <>
      {/* Hidden file input — capture=environment opens camera on mobile */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      <Pressable style={s.btn} onPress={handleClick} hitSlop={6}>
        <Text style={s.icon}>⬛</Text>
        <Text style={s.label}>Scan QR</Text>
      </Pressable>
    </>
  );
}

const s = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.primary,
    backgroundColor: theme.color.primarySoft,
  },
  icon: { fontSize: 14 },
  label: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.primary },
});
