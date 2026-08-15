import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../api';
import { theme } from '../theme';
import { useLang } from '../i18n/LanguageContext';

/**
 * KycDocPicker — lets a rider attach one or more KYC document photos. On native
 * (iOS/Android) it uses expo-image-picker: an action sheet offers camera or
 * photo-library capture, requests the matching permission, then uploads the
 * chosen image via api.uploadImage(..., { type: 'kyc' }). On web it falls back
 * to a hidden <input type="file"> (the same pattern the shopkeeper app uses).
 *
 * Uploaded files surface as thumbnails with a remove control; `onChange` is
 * called with the current list of public URLs so the parent can send them with
 * registerRider(). Busy + error states are shown inline and it never throws.
 */
export function KycDocPicker({
  label,
  values,
  onChange,
  hint,
}: {
  label: string;
  /** Current uploaded document URLs (shown as thumbnails). */
  values: string[];
  onChange: (urls: string[]) => void;
  hint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLang();

  /** Upload a file-like (Blob on web, {uri,name,type} on native) and append its URL. */
  async function upload(file: Blob | { uri: string; name: string; type: string }) {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.uploadImage(file, { type: 'kyc' });
      onChange([...values, url]);
    } catch (e) {
      setError((e as Error).message || t.register.kycUploadFailed);
    } finally {
      setBusy(false);
    }
  }

  /** Derive an RN file object from a picked asset. */
  function fileFromAsset(asset: ImagePicker.ImagePickerAsset): { uri: string; name: string; type: string } {
    const name = asset.fileName ?? `kyc-${Date.now()}.jpg`;
    const type = asset.mimeType ?? 'image/jpeg';
    return { uri: asset.uri, name, type };
  }

  /** Native: launch camera or library after requesting the right permission. */
  async function pickNative(source: 'camera' | 'library') {
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setError(t.register.kycPermissionDenied);
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.7,
        });
        if (!result.canceled && result.assets[0]) await upload(fileFromAsset(result.assets[0]));
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setError(t.register.kycPermissionDenied);
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.7,
        });
        if (!result.canceled && result.assets[0]) await upload(fileFromAsset(result.assets[0]));
      }
    } catch (e) {
      setError((e as Error).message || t.register.kycUploadFailed);
    }
  }

  /** Web: build a hidden file input and upload the chosen Blob. */
  function pickWeb() {
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment'); // hint camera on mobile web
    input.style.display = 'none';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (file) void upload(file as unknown as Blob);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  }

  function add() {
    if (busy) return;
    if (Platform.OS === 'web') {
      pickWeb();
      return;
    }
    // Native: offer a camera / library choice.
    Alert.alert(label, undefined, [
      { text: t.register.kycTakePhoto, onPress: () => void pickNative('camera') },
      { text: t.register.kycChooseLibrary, onPress: () => void pickNative('library') },
      { text: t.register.kycCancel, style: 'cancel' },
    ]);
  }

  function remove(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>

      <View style={styles.row}>
        {values.map((url, i) => (
          <View key={`${url}-${i}`} style={styles.thumbWrap}>
            <Image source={{ uri: url }} style={styles.thumb} />
            <Pressable onPress={() => remove(i)} style={styles.remove} hitSlop={8}>
              <Text style={styles.removeText}>×</Text>
            </Pressable>
          </View>
        ))}

        <Pressable
          onPress={add}
          disabled={busy}
          style={({ pressed }) => [styles.addBtn, (pressed || busy) && styles.addBtnDim]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.color.accent} />
          ) : (
            <Text style={styles.addPlus}>+</Text>
          )}
          <Text style={styles.addText}>{busy ? t.register.kycUploading : t.register.kycAddPhoto}</Text>
        </Pressable>
      </View>

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: theme.space.xs },
  label: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md, alignItems: 'center' },
  thumbWrap: { position: 'relative' },
  thumb: { width: 72, height: 72, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.color.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: theme.color.white, fontSize: 15, fontWeight: '900', lineHeight: 17 },
  addBtn: {
    width: 72,
    height: 72,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    borderStyle: 'dashed',
    backgroundColor: theme.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addBtnDim: { opacity: 0.6 },
  addPlus: { fontSize: theme.font.h2, fontWeight: '800', color: theme.color.accent, lineHeight: 22 },
  addText: { fontSize: theme.font.tiny, color: theme.color.accent, fontWeight: '700' },
  hint: { fontSize: theme.font.tiny, color: theme.color.textFaint },
  error: { color: theme.color.danger, fontSize: theme.font.tiny, fontWeight: '600' },
});
