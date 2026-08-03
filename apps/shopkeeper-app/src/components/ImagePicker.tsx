import { useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { theme } from '../theme';

/**
 * ImagePicker — a styled uploader that (on web) opens a hidden file input,
 * uploads the chosen image via api.uploadImage(), and reports the resulting URL
 * back through onUploaded(url). Shows a thumbnail preview + an uploading
 * spinner, and surfaces upload failures inline (with a graceful fallback so the
 * caller can still proceed). Native is out of scope (web-only) — there it shows
 * a note instead of a picker.
 *
 * The `capture` attribute hints the camera on mobile web.
 */
export function ImagePicker({
  label,
  value,
  onUploaded,
  onError,
  hint,
  uploadType,
  scopeId,
}: {
  label: string;
  /** Current image URL (shows as a thumbnail if present). */
  value?: string | null;
  onUploaded: (url: string) => void;
  onError?: (message: string) => void;
  hint?: string;
  /** Which folder the upload goes into (shops/products/kyc). */
  uploadType?: 'shop' | 'product' | 'kyc';
  /** The owning shop id, so files land under <type>/<shopId>/. */
  scopeId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: Blob) {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.uploadImage(file, { type: uploadType, scopeId });
      onUploaded(url);
    } catch (e) {
      const msg = (e as Error).message || 'Upload failed';
      setError(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  }

  /** Web: build a hidden <input type="file"> imperatively and click it. */
  function pick() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    // Hints the camera on mobile web; ignored on desktop.
    input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (file) void handleFile(file as unknown as Blob);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  }

  const isWeb = Platform.OS === 'web';

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>

      <View style={styles.row}>
        {value ? (
          <Image source={{ uri: value }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <Text style={styles.thumbEmptyText}>No image</Text>
          </View>
        )}

        <View style={styles.controls}>
          <Pressable
            onPress={pick}
            disabled={busy || !isWeb}
            style={({ pressed }) => [
              styles.pickBtn,
              (pressed || busy || !isWeb) && styles.pickBtnDim,
            ]}
          >
            {busy ? (
              <View style={styles.busyRow}>
                <ActivityIndicator size="small" color={theme.color.accent} />
                <Text style={styles.pickText}>Uploading…</Text>
              </View>
            ) : (
              <Text style={styles.pickText}>{value ? 'Replace photo' : 'Upload photo'}</Text>
            )}
          </Pressable>
          {!isWeb ? (
            <Text style={styles.hint}>Photo upload is available on the web app.</Text>
          ) : hint ? (
            <Text style={styles.hint}>{hint}</Text>
          ) : null}
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: theme.space.xs },
  label: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.text },
  row: { flexDirection: 'row', gap: theme.space.md, alignItems: 'center' },
  thumb: { width: 64, height: 64, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt },
  thumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.color.border,
    borderStyle: 'dashed',
  },
  thumbEmptyText: { fontSize: theme.font.tiny, color: theme.color.textFaint },
  controls: { flex: 1, gap: theme.space.xs },
  pickBtn: {
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.md,
    alignItems: 'center',
    backgroundColor: theme.color.surface,
  },
  pickBtnDim: { opacity: 0.6 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  pickText: { color: theme.color.accent, fontWeight: '700', fontSize: theme.font.small },
  hint: { fontSize: theme.font.tiny, color: theme.color.textFaint },
  error: { color: theme.color.danger, fontSize: theme.font.tiny, fontWeight: '600' },
});
