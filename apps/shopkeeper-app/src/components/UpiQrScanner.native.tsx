/**
 * UpiQrScanner (NATIVE) — scan a UPI QR code and extract the VPA on iOS/Android.
 *
 * Uses expo-camera's <CameraView> with a QR barcode scanner. Opens a full-screen
 * modal camera when tapped; on a successful scan it parses the value as a UPI
 * deep-link or bare VPA and calls onScan. A manual-entry fallback lets the user
 * type a VPA if the camera can't be used.
 *
 * The web sibling (UpiQrScanner.tsx) uses the DOM BarcodeDetector API and is
 * left untouched.
 */
import { useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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

export function UpiQrScanner({ onScan, onError }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [vpaInput, setVpaInput] = useState('');
  const [handled, setHandled] = useState(false);

  async function openScanner() {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        onError?.('Camera permission is required to scan. You can enter the UPI ID manually.');
        setManual(true);
        return;
      }
    }
    setHandled(false);
    setOpen(true);
  }

  function handleBarcode(result: { data?: string }) {
    if (handled) return;
    const raw = result?.data;
    if (!raw) return;
    setHandled(true);
    const vpa = extractVpa(raw);
    setOpen(false);
    if (!vpa) {
      onError?.(`QR scanned but no UPI ID found. Raw: "${raw.slice(0, 60)}"`);
      return;
    }
    onScan(vpa);
  }

  function submitManual() {
    const vpa = extractVpa(vpaInput);
    if (!vpa) {
      onError?.('Enter a valid UPI ID (e.g. name@bank).');
      return;
    }
    setManual(false);
    setVpaInput('');
    onScan(vpa);
  }

  return (
    <>
      <Pressable style={s.btn} onPress={openScanner} hitSlop={6}>
        <Text style={s.icon}>⬛</Text>
        <Text style={s.label}>Scan QR</Text>
      </Pressable>

      {/* Camera scanner modal */}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={s.cameraWrap}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarcode}
          />
          <View style={s.overlay} pointerEvents="box-none">
            <View style={s.frame} />
            <Text style={s.hint}>Point at a UPI QR code</Text>
          </View>
          <View style={s.controls}>
            <Pressable
              style={[s.ctrlBtn, s.ctrlSecondary]}
              onPress={() => { setOpen(false); setManual(true); }}
            >
              <Text style={s.ctrlSecondaryText}>Enter manually</Text>
            </Pressable>
            <Pressable style={s.ctrlBtn} onPress={() => setOpen(false)}>
              <Text style={s.ctrlText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Manual-entry fallback modal */}
      <Modal visible={manual} transparent animationType="fade" onRequestClose={() => setManual(false)}>
        <View style={s.manualBackdrop}>
          <View style={s.manualCard}>
            <Text style={s.manualTitle}>Enter UPI ID</Text>
            <TextInput
              style={s.manualInput}
              value={vpaInput}
              onChangeText={setVpaInput}
              placeholder="name@bank"
              placeholderTextColor={theme.color.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={s.manualRow}>
              <Pressable style={[s.ctrlBtn, s.ctrlSecondary]} onPress={() => { setManual(false); setVpaInput(''); }}>
                <Text style={s.ctrlSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable style={s.ctrlBtn} onPress={submitManual}>
                <Text style={s.ctrlText}>Use</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  cameraWrap: { flex: 1, backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: '#fff',
    borderRadius: theme.radius.lg,
    backgroundColor: 'transparent',
  },
  hint: { color: '#fff', marginTop: theme.space.lg, fontSize: theme.font.body, fontWeight: '600' },
  controls: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: theme.space.md,
    paddingHorizontal: theme.space.lg,
  },
  ctrlBtn: {
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.primary,
    alignItems: 'center',
    minWidth: 120,
  },
  ctrlText: { color: '#fff', fontWeight: '700', fontSize: theme.font.small },
  ctrlSecondary: { backgroundColor: theme.color.surface },
  ctrlSecondaryText: { color: theme.color.primary, fontWeight: '700', fontSize: theme.font.small },
  manualBackdrop: {
    flex: 1,
    backgroundColor: theme.color.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space.xl,
  },
  manualCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    gap: theme.space.md,
  },
  manualTitle: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  manualInput: {
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.md,
    fontSize: theme.font.body,
    color: theme.color.text,
  },
  manualRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.space.md },
});
