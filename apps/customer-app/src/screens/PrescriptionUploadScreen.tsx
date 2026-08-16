import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePickerExpo from 'expo-image-picker';
import { DeliveryMode } from '@nearbaz/shared';
import { api } from '../api';
import type { Address, ShopView } from '../types';
import { AddressForm } from '../components/AddressForm';
import { _shopDataCache2 } from './StorefrontScreen';
import { shadow, theme } from '../theme';
import { EditIcon } from '../EditDeleteIcons';
import { Badge, Button, Loading } from '../ui';
import { useLang } from '../i18n/LanguageContext';

/**
 * PrescriptionUploadScreen — the customer-side upload step of the medical-store
 * prescription flow. Medical shops can't be shopped from a catalog; instead the
 * customer uploads one or more prescription photos (+ an optional note), chooses
 * delivery vs self-pickup (with an address for delivery), and submits. The shop
 * later builds the bill (a different app) and the customer reviews + pays on the
 * PrescriptionReviewScreen.
 */
export function PrescriptionUploadScreen({
  shopId,
  onBack,
  onSubmitted,
}: {
  shopId: string;
  onBack: () => void;
  /** Called with the created prescription id → navigate to the review screen. */
  onSubmitted: (prescriptionId: string) => void;
}) {
  const { t } = useLang();

  // Shop config (name + geo) — seeded from the storefront cache for instant render.
  const [shop, setShop] = useState<ShopView | null>(() => _shopDataCache2.get(shopId) ?? null);
  // Uploaded prescription image URLs (server-hosted). Thumbnails render from these.
  const [images, setImages] = useState<string[]>([]);
  // Number of uploads currently in-flight (>0 shows a spinner + blocks submit).
  const [uploadingCount, setUploadingCount] = useState(0);
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'delivery' | 'pickup'>('delivery');

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [loadingAddrs, setLoadingAddrs] = useState(true);
  const [showAddrPicker, setShowAddrPicker] = useState(false);
  const [showAddrForm, setShowAddrForm] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch shop config (name + coords for the address form). Non-fatal on failure.
  useEffect(() => {
    let alive = true;
    void api.shop(shopId).then((s) => {
      if (alive) {
        setShop(s as ShopView);
        _shopDataCache2.set(shopId, s as ShopView);
      }
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [shopId]);

  const loadAddresses = useCallback(async () => {
    setLoadingAddrs(true);
    try {
      const list = (await api.addresses()) as Address[];
      setAddresses(list);
      setSelectedAddress((prev) => prev ?? (list[0]?.id ?? null));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingAddrs(false);
    }
  }, []);

  useEffect(() => {
    void loadAddresses();
  }, [loadAddresses]);

  const shopGeo = (() => {
    if (!shop) return null;
    const lat = shop.latitude != null ? Number(shop.latitude) : NaN;
    const lng = shop.longitude != null ? Number(shop.longitude) : NaN;
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  })();

  // ── Image upload ──
  async function uploadFile(file: Blob) {
    setUploadingCount((c) => c + 1);
    setError(null);
    try {
      const { url } = await api.uploadImage(file, { type: 'prescription', scopeId: shopId });
      setImages((prev) => [...prev, url]);
    } catch (e) {
      const msg = (e as Error).message || t.rx.uploadFailed;
      setError(msg);
    } finally {
      setUploadingCount((c) => Math.max(0, c - 1));
    }
  }

  async function uploadAsset(asset: ImagePickerExpo.ImagePickerAsset) {
    const uriName = asset.uri.split('/').pop()?.split('?')[0];
    const name = asset.fileName || uriName || 'prescription.jpg';
    const type = asset.mimeType || 'image/jpeg';
    const fileLike = { uri: asset.uri, name, type };
    await uploadFile(fileLike as unknown as Blob);
  }

  async function pickFromLibrary() {
    const perm = await ImagePickerExpo.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError(t.rx.libraryPermission);
      return;
    }
    const result = await ImagePickerExpo.launchImageLibraryAsync({
      mediaTypes: ImagePickerExpo.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.length) {
      for (const asset of result.assets) void uploadAsset(asset);
    }
  }

  async function takePhoto() {
    const perm = await ImagePickerExpo.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError(t.rx.cameraPermission);
      return;
    }
    const result = await ImagePickerExpo.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets?.[0]) void uploadAsset(result.assets[0]);
  }

  function pickNative() {
    Alert.alert(
      t.rx.addPhoto,
      undefined,
      [
        { text: t.rx.takePhoto, onPress: () => void takePhoto() },
        { text: t.rx.chooseFromLibrary, onPress: () => void pickFromLibrary() },
        { text: t.common.cancel, style: 'cancel' },
      ],
      { cancelable: true },
    );
  }

  function pickWeb() {
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.onchange = () => {
      const files = input.files ? Array.from(input.files) : [];
      for (const file of files) void uploadFile(file as unknown as Blob);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  }

  function addPhoto() {
    if (Platform.OS === 'web') pickWeb();
    else pickNative();
  }

  function removeImage(url: string) {
    setImages((prev) => prev.filter((u) => u !== url));
  }

  // ── Submit ──
  const isDelivery = mode === 'delivery';
  async function submit() {
    setError(null);
    if (images.length === 0) {
      setError(t.rx.needPhotoError);
      return;
    }
    if (isDelivery && !selectedAddress) {
      setError(t.rx.needAddressError);
      return;
    }
    setSubmitting(true);
    try {
      const rx = await api.createPrescription({
        shopId,
        imageUrls: images,
        note: note.trim() || undefined,
        deliveryMode: isDelivery ? DeliveryMode.SELF_DELIVERY : DeliveryMode.SELF_PICKUP,
        addressId: isDelivery ? (selectedAddress ?? undefined) : undefined,
      });
      onSubmitted(rx.id);
    } catch (e) {
      setError((e as Error).message || t.rx.submitFailed);
    } finally {
      setSubmitting(false);
    }
  }

  const selectedAddr = addresses.find((a) => a.id === selectedAddress);
  const uploading = uploadingCount > 0;
  const canSubmit =
    images.length > 0 && !uploading && !submitting && (!isDelivery || !!selectedAddress);

  return (
    <View style={styles.root}>
      <Header onBack={onBack} title={t.rx.uploadTitle} subtitle={shop?.name ?? undefined} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Prescription photos */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.rx.photosTitle}</Text>
          <Text style={styles.hint}>{t.rx.photosHint}</Text>
          <View style={styles.thumbGrid}>
            {images.map((url) => (
              <View key={url} style={styles.thumbWrap}>
                <Image source={{ uri: url }} style={styles.thumb} />
                <Pressable style={styles.thumbRemove} onPress={() => removeImage(url)} hitSlop={6}>
                  <Text style={styles.thumbRemoveText}>✕</Text>
                </Pressable>
              </View>
            ))}
            {uploading ? (
              <View style={[styles.thumb, styles.thumbUploading]}>
                <ActivityIndicator size="small" color={theme.color.primary} />
              </View>
            ) : null}
            <Pressable style={styles.addTile} onPress={addPhoto} disabled={submitting}>
              <Text style={styles.addTilePlus}>＋</Text>
              <Text style={styles.addTileText}>{t.rx.addPhoto}</Text>
            </Pressable>
          </View>
        </View>

        {/* Note */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.rx.noteTitle}</Text>
          <TextInput
            style={styles.noteInput}
            placeholder={t.rx.notePlaceholder}
            placeholderTextColor={theme.color.textFaint}
            value={note}
            onChangeText={setNote}
            multiline
          />
        </View>

        {/* Delivery vs pickup */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.rx.fulfilmentTitle}</Text>
          <View style={styles.segment}>
            <Pressable
              onPress={() => setMode('delivery')}
              style={[styles.segmentBtn, isDelivery && styles.segmentBtnActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: isDelivery }}
            >
              <Text style={[styles.segmentText, isDelivery && styles.segmentTextActive]}>
                {t.rx.delivery}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setMode('pickup')}
              style={[styles.segmentBtn, !isDelivery && styles.segmentBtnActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: !isDelivery }}
            >
              <Text style={[styles.segmentText, !isDelivery && styles.segmentTextActive]}>
                {t.rx.pickup}
              </Text>
            </Pressable>
          </View>
          {!isDelivery ? <Text style={styles.pickupNote}>{t.rx.pickupNote}</Text> : null}
        </View>

        {/* Delivery address — only for delivery */}
        {isDelivery ? (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t.rx.deliveryAddress}</Text>
              <Pressable onPress={() => setShowAddrForm(true)}>
                <Text style={styles.link}>{t.rx.addNew}</Text>
              </Pressable>
            </View>
            {loadingAddrs ? (
              <Loading />
            ) : !selectedAddr ? (
              <Text style={styles.namePrompt}>{t.rx.selectAddressPrompt}</Text>
            ) : (
              <View style={[styles.addrCard, styles.addrCardActive]}>
                <View style={styles.flex}>
                  <Text style={styles.addrLabelText}>{selectedAddr.label}</Text>
                  <Text style={styles.addrLine}>{selectedAddr.line}</Text>
                  {selectedAddr.landmark ? (
                    <Text style={styles.addrLandmark}>{t.common.near} {selectedAddr.landmark}</Text>
                  ) : null}
                </View>
                {addresses.length > 1 ? (
                  <Pressable onPress={() => setShowAddrPicker(true)} hitSlop={8} style={styles.addrEditBtn} accessibilityLabel={t.common.change}>
                    <EditIcon size={18} color={theme.color.primary} />
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      {/* Submit bar */}
      <View style={styles.submitBar}>
        <Button
          label={submitting ? t.rx.submitting : t.rx.submit}
          onPress={submit}
          busy={submitting}
          disabled={!canSubmit}
          size="lg"
        />
      </View>

      {/* Address picker */}
      <Modal
        visible={showAddrPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddrPicker(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{t.rx.chooseAddress}</Text>
              <Pressable onPress={() => setShowAddrPicker(false)} hitSlop={8}>
                <Text style={styles.sheetClose}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
              {addresses.map((addr) => {
                const active = addr.id === selectedAddress;
                return (
                  <Pressable
                    key={addr.id}
                    onPress={() => {
                      setSelectedAddress(addr.id);
                      setShowAddrPicker(false);
                    }}
                    style={[styles.addrCard, active && styles.addrCardActive]}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.addrLabelText}>{addr.label}</Text>
                      <Text style={styles.addrLine}>{addr.line}</Text>
                      {addr.landmark ? (
                        <Text style={styles.addrLandmark}>{t.common.near} {addr.landmark}</Text>
                      ) : null}
                    </View>
                    <View style={[styles.radio, active && styles.radioActive]}>
                      {active ? <View style={styles.radioDot} /> : null}
                    </View>
                  </Pressable>
                );
              })}
              <Button
                label={t.rx.addNewAddress}
                variant="outline"
                onPress={() => { setShowAddrPicker(false); setShowAddrForm(true); }}
                style={styles.sheetAddBtn}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Add-new-address form */}
      <Modal
        visible={showAddrForm}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddrForm(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{t.rx.addAddress}</Text>
              <Pressable onPress={() => setShowAddrForm(false)} hitSlop={8}>
                <Text style={styles.sheetClose}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
              <AddressForm
                shopGeo={shopGeo}
                onSaved={async (id) => {
                  setShowAddrForm(false);
                  await loadAddresses();
                  setSelectedAddress(id);
                }}
                onError={setError}
                onCancel={() => setShowAddrForm(false)}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Header({ onBack, title, subtitle }: { onBack: () => void; title: string; subtitle?: string }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerBack}>
        <Text style={styles.headerBackText}>←</Text>
      </Pressable>
      <View>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  flex: { flex: 1 },
  scroll: { paddingBottom: 120, gap: theme.space.md, paddingTop: theme.space.md },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    backgroundColor: theme.color.bg,
    ...shadow.sm,
  },
  headerBack: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBackText: { fontSize: 20, fontWeight: theme.weight.bold, color: theme.color.text },
  headerTitle: { fontSize: theme.font.h2, fontWeight: theme.weight.bold, color: theme.color.text },
  headerSubtitle: { fontSize: theme.font.small, color: theme.color.textMuted },

  section: {
    backgroundColor: theme.color.card,
    marginHorizontal: theme.space.lg,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    gap: theme.space.sm,
    ...shadow.sm,
  },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: theme.font.h3, fontWeight: theme.weight.bold, color: theme.color.text, marginBottom: 2 },
  hint: { fontSize: theme.font.small, color: theme.color.textMuted },
  link: { color: theme.color.primary, fontWeight: theme.weight.semibold, fontSize: theme.font.small },

  thumbGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginTop: theme.space.xs },
  thumbWrap: { position: 'relative' },
  thumb: { width: 84, height: 84, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt },
  thumbUploading: { alignItems: 'center', justifyContent: 'center' },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.color.danger,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.sm,
  },
  thumbRemoveText: { color: '#fff', fontSize: 12, fontWeight: '800', lineHeight: 14 },
  addTile: {
    width: 84,
    height: 84,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    borderColor: theme.color.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: theme.color.surface,
  },
  addTilePlus: { fontSize: 24, color: theme.color.primary, fontWeight: '800' },
  addTileText: { fontSize: theme.font.tiny, color: theme.color.primary, fontWeight: theme.weight.semibold },

  noteInput: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    fontSize: theme.font.body,
    color: theme.color.text,
    minHeight: 60,
    textAlignVertical: 'top',
  },

  segment: {
    flexDirection: 'row',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 3,
    gap: 3,
    marginTop: theme.space.xs,
  },
  segmentBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.space.sm,
    paddingHorizontal: 2,
    borderRadius: theme.radius.sm,
  },
  segmentBtnActive: { backgroundColor: theme.color.bg, ...shadow.sm },
  segmentText: { fontSize: theme.font.small, fontWeight: theme.weight.semibold, color: theme.color.textMuted, textAlign: 'center' },
  segmentTextActive: { color: theme.color.primary },
  pickupNote: { fontSize: theme.font.small, color: theme.color.success, marginTop: theme.space.sm, fontWeight: theme.weight.medium },

  addrCard: {
    flexDirection: 'row',
    gap: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    borderColor: theme.color.border,
    marginTop: theme.space.sm,
    alignItems: 'flex-start',
  },
  addrCardActive: { borderColor: theme.color.primary, backgroundColor: theme.color.primaryLight },
  addrLabelText: { fontSize: theme.font.small, fontWeight: theme.weight.bold, color: theme.color.text, marginBottom: 4 },
  addrLine: { fontSize: theme.font.body, color: theme.color.text, fontWeight: theme.weight.medium },
  addrLandmark: { fontSize: theme.font.small, color: theme.color.textMuted },
  addrEditBtn: {
    width: 30,
    height: 30,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  addrEditIcon: { fontSize: 15, color: theme.color.textMuted, fontWeight: theme.weight.bold },
  namePrompt: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space.sm },

  radio: {
    width: 22,
    height: 22,
    borderRadius: theme.radius.pill,
    borderWidth: 2,
    borderColor: theme.color.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioActive: { borderColor: theme.color.primary },
  radioDot: { width: 10, height: 10, borderRadius: theme.radius.pill, backgroundColor: theme.color.primary },

  error: {
    color: theme.color.danger,
    textAlign: 'center',
    marginHorizontal: theme.space.lg,
    fontWeight: theme.weight.medium,
  },

  submitBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.lg,
    backgroundColor: theme.color.bg,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    ...shadow.lg,
  },

  sheetBackdrop: { flex: 1, backgroundColor: theme.color.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.color.bg,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.lg,
    paddingBottom: theme.space.xl,
    width: '100%',
    maxWidth: theme.maxContentWidth,
    alignSelf: 'center',
    maxHeight: '88%',
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.space.sm },
  sheetTitle: { fontSize: theme.font.h2, fontWeight: theme.weight.bold, color: theme.color.text },
  sheetClose: { fontSize: theme.font.h2, color: theme.color.textMuted, fontWeight: theme.weight.bold },
  sheetScroll: { flexGrow: 0 },
  sheetAddBtn: { marginTop: theme.space.md },
});
