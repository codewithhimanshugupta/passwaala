import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePickerExpo from 'expo-image-picker';
import { api } from '../api';
import { theme } from '../theme';

/**
 * ImagePicker — a styled uploader that uploads a chosen image via
 * api.uploadImage() and reports the resulting URL back through onUploaded(url).
 * Shows a thumbnail preview + an uploading spinner, and surfaces upload failures
 * inline (with a graceful fallback so the caller can still proceed).
 *
 * On web it opens a hidden file input (the `capture` attribute hints the camera
 * on mobile web). On native (iOS/Android) it uses expo-image-picker to let the
 * user pick from their library or take a photo with the camera.
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

  /** Upload a React-Native asset (from expo-image-picker) as {uri,name,type}. */
  async function handleAsset(asset: ImagePickerExpo.ImagePickerAsset) {
    const uriName = asset.uri.split('/').pop()?.split('?')[0];
    const name = asset.fileName || uriName || 'photo.jpg';
    const type = asset.mimeType || 'image/jpeg';
    const fileLike = { uri: asset.uri, name, type };
    // api.uploadImage accepts a React-Native {uri,name,type} object; the Blob
    // param type is satisfied via a cast.
    await handleFile(fileLike as unknown as Blob);
  }

  async function pickFromLibrary() {
    const perm = await ImagePickerExpo.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo library permission is required.');
      return;
    }
    const result = await ImagePickerExpo.launchImageLibraryAsync({
      mediaTypes: ImagePickerExpo.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]) void handleAsset(result.assets[0]);
  }

  async function takePhoto() {
    const perm = await ImagePickerExpo.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('Camera permission is required.');
      return;
    }
    const result = await ImagePickerExpo.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets?.[0]) void handleAsset(result.assets[0]);
  }

  /** Native: let the user choose between the library and the camera. */
  function pickNative() {
    Alert.alert(
      'Add photo',
      undefined,
      [
        { text: 'Take photo', onPress: () => void takePhoto() },
        { text: 'Choose from library', onPress: () => void pickFromLibrary() },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true },
    );
  }

  /** Web: build a hidden <input type="file"> imperatively and click it. */
  function pickWeb() {
    if (typeof document === 'undefined') return;
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

  function pick() {
    if (Platform.OS === 'web') pickWeb();
    else pickNative();
  }

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
            disabled={busy}
            style={({ pressed }) => [
              styles.pickBtn,
              (pressed || busy) && styles.pickBtnDim,
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
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
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
