import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { haversineMeters, isWithinDeliveryRange, platformDeliveryFeePaise } from '@nearbaz/shared';
import { api } from '../api';
import type { Address } from '../types';
import { theme } from '../theme';
import { formatDistance, formatRupees } from '../theme';
import { Button } from '../ui';
import { LocationPicker } from './LocationPicker';
import type { PickedLocation } from './LocationPicker';
import { useLang } from '../i18n/LanguageContext';

const JHANSI_LAT = 22.9734; // India geographic center (neutral GPS fallback)
const JHANSI_LNG = 78.6569;

export function AddressForm({
  address,
  onSaved,
  onError,
  onCancel,
  shopGeo,
  deliveryRadiusMeters,
  platformDelivery,
}: {
  address?: Address;
  onSaved: (id: string) => void;
  onError: (msg: string) => void;
  onCancel?: () => void;
  /** Optional shop location — when provided, the form checks the dropped pin is
   *  within delivery range and previews the distance-based delivery fee live. */
  shopGeo?: { lat: number; lng: number } | null;
  /** Shop's serviceable radius (metres). Defaults to the shared max when omitted. */
  deliveryRadiusMeters?: number;
  /** Whether the shop uses NearBaz-rider (distance-tiered) delivery — drives the fee preview. */
  platformDelivery?: boolean;
}) {
  const { t } = useLang();
  const editing = !!address;

  // Stored label values stay canonical (English) for the backend/badges; only
  // the chip display text is localized.
  const LABELS: { value: string; display: string }[] = [
    { value: 'Home', display: t.addressForm.labelHome },
    { value: 'Work', display: t.addressForm.labelWork },
    { value: 'Other', display: t.addressForm.labelOther },
  ];

  const [label, setLabel]       = useState(address?.label ?? 'Home');
  const [flat, setFlat]         = useState('');
  const [houseNo, setHouseNo]   = useState('');
  const [street, setStreet]     = useState('');
  const [area, setArea]         = useState('');
  const [landmark, setLandmark] = useState(address?.landmark ?? '');
  const [coords, setCoords]     = useState<PickedLocation>({
    lat: address?.latitude  ? Number(address.latitude)  : JHANSI_LAT,
    lng: address?.longitude ? Number(address.longitude) : JHANSI_LNG,
  });
  const [busy, setBusy]         = useState(false);
  // Field-level errors shown inline; also a general error slot.
  const [errors, setErrors]     = useState<{ houseNo?: string; street?: string; area?: string; general?: string }>({});

  // Live delivery serviceability + fee preview, computed from the dropped pin
  // relative to the shop (only when the caller passes shopGeo — e.g. from cart).
  const dropInRange = shopGeo
    ? isWithinDeliveryRange(
        { latitude: shopGeo.lat, longitude: shopGeo.lng },
        { latitude: coords.lat, longitude: coords.lng },
        deliveryRadiusMeters,
      )
    : true;
  const dropDistanceMeters = shopGeo
    ? haversineMeters({ latitude: shopGeo.lat, longitude: shopGeo.lng }, { latitude: coords.lat, longitude: coords.lng })
    : null;
  // Distance-tiered fee only meaningful for platform (NearBaz-rider) delivery.
  const previewFeePaise =
    shopGeo && platformDelivery && dropDistanceMeters != null && dropInRange
      ? platformDeliveryFeePaise(dropDistanceMeters)
      : null;

  function handlePick(loc: PickedLocation) {
    setCoords(loc);
    if (loc.street) setStreet(loc.street);
    if (loc.area)   setArea(loc.area);
    // Clear auto-filled field errors when pin moves.
    setErrors((e) => ({ ...e, street: undefined, area: undefined }));
  }

  function buildLine(): string {
    return [flat.trim(), houseNo.trim(), street.trim(), area.trim()]
      .filter(Boolean)
      .join(', ');
  }

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!houseNo.trim()) errs.houseNo = t.addressForm.houseRequired;
    if (!street.trim())  errs.street  = t.addressForm.streetRequired;
    if (!area.trim())    errs.area    = t.addressForm.areaRequired;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function save() {
    if (!validate()) return;
    // Block saving an address that's outside the shop's delivery range (only
    // enforced when the cart passed shop context). The server also re-checks.
    if (shopGeo && !dropInRange) {
      setErrors({ general: t.addressForm.outOfRange });
      return;
    }
    const line = buildLine();
    setBusy(true);
    setErrors({});
    try {
      if (editing && address) {
        await api.updateAddress(address.id, {
          line,
          landmark: landmark.trim() || undefined,
          label: label.trim() || 'Home',
          latitude: coords.lat,
          longitude: coords.lng,
        });
        onSaved(address.id);
      } else {
        const { id } = await api.createAddress({
          line,
          landmark: landmark.trim() || undefined,
          latitude: coords.lat,
          longitude: coords.lng,
          label: label.trim() || 'Home',
        });
        onSaved(id);
      }
    } catch (e) {
      // API errors go to parent's error handler (shown above the form).
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      {/* Label chips */}
      <View style={styles.labelChips}>
        {LABELS.map((l) => (
          <Pressable
            key={l.value}
            onPress={() => setLabel(l.value)}
            style={[styles.labelChip, label === l.value && styles.labelChipActive]}
          >
            <Text style={[styles.labelChipText, label === l.value && styles.labelChipTextActive]}>{l.display}</Text>
          </Pressable>
        ))}
      </View>

      {/* Drop-pin map */}
      <View>
        <View style={styles.sectionLabelRow}>
          <Text style={styles.sectionLabel}>{t.addressForm.dropPinHint}</Text>
          <Text style={styles.coordsHint}>{coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</Text>
        </View>
        <LocationPicker initial={coords} onChange={handlePick} />
      </View>

      {/* Live delivery serviceability + fee preview (only when cart passes shop context). */}
      {shopGeo && !dropInRange ? (
        <View style={styles.rangeError}>
          <Text style={styles.rangeErrorText}>
            {dropDistanceMeters != null
              ? t.addressForm.outOfRangeAt(formatDistance(dropDistanceMeters) ?? '')
              : t.addressForm.outOfRange}
          </Text>
        </View>
      ) : shopGeo && previewFeePaise != null ? (
        <View style={styles.feePreview}>
          <Text style={styles.feePreviewText}>
            {t.addressForm.deliveryFeePreview(formatRupees(previewFeePaise))}
          </Text>
        </View>
      ) : null}

      {/* Address fields */}
      <Text style={styles.sectionLabel}>{t.addressForm.addressDetails}</Text>

      {/* Flat + House side by side */}
      <View style={styles.row}>
        <View style={[styles.inputWrap, styles.flex]}>
          <Text style={styles.fieldLabel}>{t.addressForm.flatFloor}</Text>
          <TextInput
            style={styles.input}
            placeholder={t.addressForm.flatPlaceholder}
            placeholderTextColor={theme.color.textFaint}
            value={flat}
            onChangeText={setFlat}
          />
        </View>
        <View style={[styles.inputWrap, styles.flex]}>
          <Text style={styles.fieldLabel}>{t.addressForm.housePlot} <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={[styles.input, errors.houseNo ? styles.inputError : null]}
            placeholder={t.addressForm.housePlaceholder}
            placeholderTextColor={theme.color.textFaint}
            value={houseNo}
            onChangeText={(v) => { setHouseNo(v); setErrors((e) => ({ ...e, houseNo: undefined })); }}
          />
          {errors.houseNo ? <Text style={styles.fieldError}>{errors.houseNo}</Text> : null}
        </View>
      </View>

      {/* Street */}
      <View style={styles.inputWrap}>
        <Text style={styles.fieldLabel}>{t.addressForm.street} <Text style={styles.required}>*</Text>  <Text style={styles.autoTag}>{t.addressForm.autoFilled}</Text></Text>
        <TextInput
          style={[styles.input, errors.street ? styles.inputError : null]}
          placeholder={t.addressForm.streetPlaceholder}
          placeholderTextColor={theme.color.textFaint}
          value={street}
          onChangeText={(v) => { setStreet(v); setErrors((e) => ({ ...e, street: undefined })); }}
        />
        {errors.street ? <Text style={styles.fieldError}>{errors.street}</Text> : null}
      </View>

      {/* Area */}
      <View style={styles.inputWrap}>
        <Text style={styles.fieldLabel}>{t.addressForm.areaLocality} <Text style={styles.required}>*</Text>  <Text style={styles.autoTag}>{t.addressForm.autoFilled}</Text></Text>
        <TextInput
          style={[styles.input, errors.area ? styles.inputError : null]}
          placeholder={t.addressForm.areaPlaceholder}
          placeholderTextColor={theme.color.textFaint}
          value={area}
          onChangeText={(v) => { setArea(v); setErrors((e) => ({ ...e, area: undefined })); }}
        />
        {errors.area ? <Text style={styles.fieldError}>{errors.area}</Text> : null}
      </View>

      {/* Landmark */}
      <View style={styles.inputWrap}>
        <Text style={styles.fieldLabel}>{t.addressForm.landmarkOptional}</Text>
        <TextInput
          style={styles.input}
          placeholder={t.addressForm.landmarkPlaceholder}
          placeholderTextColor={theme.color.textFaint}
          value={landmark}
          onChangeText={setLandmark}
        />
      </View>

      {/* Full address preview */}
      {buildLine() ? (
        <View style={styles.preview}>
          <Text style={styles.previewLabel}>{t.addressForm.fullPreview}</Text>
          <Text style={styles.previewText}>{buildLine()}</Text>
        </View>
      ) : null}

      {errors.general ? <Text style={styles.generalError}>{errors.general}</Text> : null}

      <Button label={editing ? t.addressForm.saveChanges : t.addressForm.saveAddress} onPress={save} busy={busy} />
      {onCancel ? <Button label={t.common.cancel} onPress={onCancel} variant="ghost" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: theme.space.sm, marginTop: theme.space.sm },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: theme.space.sm },

  labelChips: { flexDirection: 'row', gap: theme.space.sm },
  labelChip: {
    paddingHorizontal: theme.space.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
  },
  labelChipActive: { backgroundColor: theme.color.primary },
  labelChipText: { fontSize: theme.font.small, fontWeight: theme.weight.semibold, color: theme.color.textMuted },
  labelChipTextActive: { color: theme.color.onPrimary },

  sectionLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.space.xs },
  sectionLabel: { fontSize: theme.font.small, fontWeight: theme.weight.bold, color: theme.color.text },
  coordsHint: { fontSize: theme.font.tiny, color: theme.color.textMuted, fontFamily: 'monospace' },

  inputWrap: { gap: 4 },
  fieldLabel: { fontSize: theme.font.tiny, fontWeight: theme.weight.semibold, color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  required: { color: theme.color.danger },
  autoTag: { color: theme.color.primary, textTransform: 'none', fontWeight: theme.weight.medium, letterSpacing: 0 },
  input: {
    borderWidth: 1.5,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    fontSize: theme.font.body,
    color: theme.color.text,
  },
  inputError: { borderColor: theme.color.danger, backgroundColor: theme.color.dangerLight },
  fieldError: { fontSize: theme.font.tiny, color: theme.color.danger, fontWeight: theme.weight.semibold },

  rangeError: {
    backgroundColor: theme.color.dangerLight,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.danger,
    padding: theme.space.md,
  },
  rangeErrorText: { fontSize: theme.font.small, color: theme.color.danger, fontWeight: theme.weight.semibold },
  feePreview: {
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
  },
  feePreviewText: { fontSize: theme.font.small, color: theme.color.text, fontWeight: theme.weight.semibold },
  generalError: { fontSize: theme.font.small, color: theme.color.danger, fontWeight: theme.weight.semibold, textAlign: 'center' },

  preview: {
    backgroundColor: theme.color.primaryLight,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    gap: 2,
  },
  previewLabel: { fontSize: theme.font.tiny, color: theme.color.primaryDark, fontWeight: theme.weight.bold, textTransform: 'uppercase', letterSpacing: 0.4 },
  previewText: { fontSize: theme.font.small, color: theme.color.text, fontWeight: theme.weight.medium },
});
