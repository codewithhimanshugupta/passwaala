import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { VerificationStatus } from '@nearbaz/shared';
import { api } from '../api';
import { placeholderImage, rupeeInputToPaise, theme } from '../theme';
import { Banner, Button, Card, ErrorText, Field, Screen } from '../ui';
import { ImagePicker } from '../components/ImagePicker';
import { LocationPicker } from '../components/LocationPicker';
import { LanguagePicker } from '../components/LanguagePicker';
import { UpiQrScanner } from '../components/UpiQrScanner';
import type { PickedLocation } from '../components/LocationPicker';
import { useLang } from '../i18n/LanguageContext';
import type { Strings } from '../i18n/strings';
import type { MyShop } from '../types';

const CATEGORIES = [
  'kirana', 'dairy', 'medical', 'fruits-veg', 'bakery',
  'electronics', 'clothing', 'hardware', 'stationery',
];

const FALLBACK_COORDS = { latitude: 22.9734, longitude: 78.6569 };
const FALLBACK_CITY = '';

interface NominatimAddress {
  city?: string; town?: string; state_district?: string; county?: string;
}

function cityFromNominatim(a: NominatimAddress): string {
  return a.city || a.town || a.state_district || a.county || FALLBACK_CITY;
}

// Step indicator
function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <View style={si.row}>
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <View key={n} style={si.item}>
            <View style={[si.circle, done && si.done, active && si.active]}>
              <Text style={[si.num, (done || active) && si.numLight]}>{done ? '✓' : n}</Text>
            </View>
            {i < total - 1 ? <View style={[si.line, done && si.lineDone]} /> : null}
          </View>
        );
      })}
    </View>
  );
}

const si = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: theme.space.lg },
  item: { flexDirection: 'row', alignItems: 'center' },
  circle: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: theme.color.border, backgroundColor: theme.color.surface, alignItems: 'center', justifyContent: 'center' },
  done: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  active: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  num: { fontSize: theme.font.small, fontWeight: '800', color: theme.color.textMuted },
  numLight: { color: '#fff' },
  line: { width: 40, height: 2, backgroundColor: theme.color.border, marginHorizontal: theme.space.xs },
  lineDone: { backgroundColor: theme.color.primary },
});

// Category dropdown
function CategoryDropdown({ value, onChange, t }: { value: string; onChange: (v: string) => void; t: Strings }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Text style={styles.fieldLabel}>{t.register.category}</Text>
      <Pressable style={styles.dropdown} onPress={() => setOpen((v) => !v)}>
        <Text style={styles.dropdownValue}>{value}</Text>
        <Text style={styles.dropdownArrow}>{open ? '▲' : '▼'}</Text>
      </Pressable>
      {open && (
        <View style={styles.dropdownList}>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c}
              style={[styles.dropdownItem, c === value && styles.dropdownItemActive]}
              onPress={() => { onChange(c); setOpen(false); }}
            >
              <Text style={[styles.dropdownItemText, c === value && styles.dropdownItemTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export function RegisterShopScreen({ onRegistered }: { onRegistered: (shop: MyShop) => void }) {
  const { t } = useLang();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1 — Basics
  const [name, setName] = useState('');
  const [shopCategory, setCategory] = useState('kirana');
  const [photoUrl, setPhotoUrl] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [referralNote, setReferralNote] = useState<string | null>(null);

  // Step 2 — Location
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [city, setCity] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [serviceable, setServiceable] = useState<string[] | null>(null);
  const cityTrimmed = city.trim();

  // Step 3 — Delivery options + Coupons
  const [upiVpa, setUpiVpa] = useState('');
  const [upiScanError, setUpiScanError] = useState<string | null>(null);
  const [deliveryFee, setDeliveryFee] = useState('');
  const [freeAbove, setFreeAbove] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [platformDeliveryEnabled, setPlatformDeliveryEnabled] = useState(true);
  const [selfPickupEnabled, setSelfPickupEnabled] = useState(true);
  const [activeOfferIds, setActiveOfferIds] = useState<string[]>([]);
  const [cityOffers, setCityOffers] = useState<Array<{ id: string; title: string; type: string; value: number; minOrderPaise: number }>>([]);

  // Step 4 — KYC (same as Settings › KYC & Verification)
  const [aadhaarPan, setAadhaarPan] = useState('');
  const [gstOrLicence, setGstOrLicence] = useState('');
  const [fssai, setFssai] = useState('');
  const [bankProofUrl, setBankProofUrl] = useState('');
  const [registeredShopId, setRegisteredShopId] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 2) return;
    let alive = true;
    setServiceable(null);
    api.serviceableCities()
      .then((list) => { if (alive) setServiceable(list.map(c => c.name)); })
      .catch(() => { if (alive) setServiceable([]); });
    return () => { alive = false; };
  }, [step]);

  // Load city offer templates when entering step 3
  useEffect(() => {
    if (step !== 3 || !cityTrimmed) return;
    let alive = true;
    api.serviceableCities().then((cities) => {
      if (!alive) return;
      const match = cities.find(c =>
        cityTrimmed.toLowerCase().includes(c.name.toLowerCase()) ||
        c.name.toLowerCase().includes(cityTrimmed.toLowerCase())
      );
      if (match) setCityOffers(match.offers);
    }).catch(() => {});
    return () => { alive = false; };
  }, [step, cityTrimmed]);


  const cityNotServiceable =
    cityTrimmed.length > 0 && serviceable !== null && serviceable.length > 0 &&
    !serviceable.some((c) => c.trim().toLowerCase() === cityTrimmed.toLowerCase());

  const previewUrl = photoUrl.trim() || placeholderImage(name.trim() || shopCategory, 600, 320);

  const handleLocationPick = useCallback((loc: PickedLocation) => {
    setCoords({ latitude: loc.lat, longitude: loc.lng });
    if (loc.area) {
      const parts = loc.area.split(',').map((p) => p.trim()).filter(Boolean);
      const detectedCity = parts[parts.length - 1] || '';
      if (detectedCity) setCity(detectedCity);
    }
    if (loc.street || loc.area) setAddressLine([loc.street, loc.area].filter(Boolean).join(', '));
  }, []);

  function goTo(next: 1 | 2 | 3 | 4) { setStep(next); setError(null); }

  // Submit shop (called at end of step 3)
  async function submit() {
    if (name.trim().length < 2) { setError(t.register.enterShopName); return; }
    if (cityNotServiceable) { setError(t.register.notServiceableShort(cityTrimmed)); return; }
    setBusy(true); setError(null);
    const location = coords ?? FALLBACK_COORDS;
    try {
      const res = (await api.registerShop({
        name: name.trim(),
        shopCategory,
        storefrontPhotoUrl: previewUrl,
        logoUrl: logoUrl.trim() || undefined,
        latitude: location.latitude,
        longitude: location.longitude,
        upiVpa: upiVpa.trim() || undefined,
        city: cityTrimmed || undefined,
        addressLine: addressLine.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        deliveryFeePaise: rupeeInputToPaise(deliveryFee),
        freeDeliveryAbovePaise: freeAbove.trim() ? rupeeInputToPaise(freeAbove) : undefined,
        minOrderValuePaise: rupeeInputToPaise(minOrder),
        platformDeliveryEnabled,
        selfPickupEnabled,
      })) as { shop: MyShop; accessToken: string };
      api.setToken(res.accessToken);
      setRegisteredShopId(res.shop.id);
      // Save coupons + delivery settings immediately after registration
      if (activeOfferIds.length > 0 || upiVpa.trim()) {
        try {
          await api.updateShopSettings({ activeOfferIds, upiVpa: upiVpa.trim() || undefined });
        } catch { /* non-fatal */ }
      }
      const code = referralCode.trim();
      if (code) {
        try { await api.applyReferral(code); }
        catch (refErr) { setReferralNote((refErr as Error).message || t.register.referralFailed); }
      }
      goTo(4);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  // Submit KYC (step 4)
  async function submitKyc() {
    if (!registeredShopId) return;
    if (aadhaarPan.trim().length < 4) { setError(t.settings.enterAadhaarPan); return; }
    if (gstOrLicence.trim().length < 2) { setError(t.settings.enterGstOrLicence); return; }
    setBusy(true); setError(null);
    try {
      const bank = bankProofUrl.trim() || `https://picsum.photos/seed/${registeredShopId}-bank/600/400`;
      await api.submitKyc({
        aadhaarPan: aadhaarPan.trim(),
        gstOrLicence: gstOrLicence.trim(),
        fssai: fssai.trim() || undefined,
        bankProofUrl: bank,
        docUrls: [`https://picsum.photos/seed/${registeredShopId}-doc1/600/400`],
      });
      const shop = (await api.myShop()) as MyShop;
      onRegistered(shop);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  const stepTitles = [t.register.stepBasics, t.register.stepLocation, 'Delivery Options', 'KYC & Verification'];

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>{t.register.title}</Text>
        <Text style={styles.subtitle}>{stepTitles[step - 1]}</Text>
      </View>

      <LanguagePicker label={t.common.language} />
      <StepIndicator current={step} total={4} />

      {/* Step 1 — Basics */}
      {step === 1 && (
        <Card>
          <Image source={{ uri: previewUrl }} style={styles.preview} />
          <View style={{ gap: theme.space.md, marginTop: theme.space.md }}>
            <Field label={t.register.shopName} placeholder={t.register.shopNamePlaceholder} value={name} onChangeText={setName} />
            <CategoryDropdown value={shopCategory} onChange={setCategory} t={t} />
            <ImagePicker label={t.register.storefrontPhoto} value={photoUrl.trim() || null} onUploaded={setPhotoUrl} hint={t.register.storefrontPhotoHint} uploadType="shop" />
            <ImagePicker label="Shop logo (optional)" value={logoUrl.trim() || null} onUploaded={setLogoUrl} hint="Square logo shown on your shop card." uploadType="shop" />
            <Field label={t.register.referralCode} placeholder={t.register.referralPlaceholder} autoCapitalize="characters" value={referralCode} onChangeText={setReferralCode} hint={t.register.referralHint} />
            {referralNote ? <ErrorText>{referralNote}</ErrorText> : null}
          </View>
        </Card>
      )}

      {/* Step 2 — Location */}
      {step === 2 && (
        <Card>
          <View style={{ gap: theme.space.md }}>
            <Text style={styles.mapLabel}>{t.register.pinOnMap}</Text>
            <Text style={styles.mapHint}>{t.register.pinHint}</Text>
            <LocationPicker initial={coords ? { lat: coords.latitude, lng: coords.longitude } : undefined} onChange={handleLocationPick} />
            <Field label={t.register.city} placeholder={t.register.cityPlaceholder} value={city} onChangeText={setCity} hint={t.register.cityHint} />
            {cityTrimmed.length > 0 && serviceable !== null && (cityNotServiceable || serviceable.length === 0) ? (
              <Banner tone="danger" title={`NearBaz is not available in ${cityTrimmed} yet`}
                message={serviceable.length > 0 ? `We currently operate in: ${serviceable.join(', ')}.` : 'NearBaz hasn\'t launched in your city yet.'} />
            ) : cityTrimmed && serviceable !== null && serviceable.length > 0 && !cityNotServiceable ? (
              <Banner tone="success" title={`${cityTrimmed} is a serviceable city`} message="You can proceed to the next step." />
            ) : null}
            <Field label={t.register.addressLine} placeholder={t.register.addressPlaceholder} value={addressLine} onChangeText={setAddressLine} />
            <Field label={t.register.contactPhone} placeholder={t.register.contactPhonePlaceholder} keyboardType="phone-pad" maxLength={15} value={contactPhone} onChangeText={setContactPhone} />
          </View>
        </Card>
      )}

      {/* Step 3 — Delivery Options (matches Settings › Delivery Options) */}
      {step === 3 && (
        <Card>
          <View style={{ gap: theme.space.md }}>
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Field label="UPI ID" placeholder="yourshop@upi" autoCapitalize="none" value={upiVpa} onChangeText={(v) => { setUpiScanError(null); setUpiVpa(v); }} hint="Customers pay to this UPI ID" />
                </View>
                <UpiQrScanner
                  onScan={(vpa) => { setUpiScanError(null); setUpiVpa(vpa); }}
                  onError={(msg) => setUpiScanError(msg)}
                />
              </View>
              {upiScanError ? <Text style={{ fontSize: 12, color: theme.color.danger }}>{upiScanError}</Text> : null}
            </View>
            <View style={styles.toggleRow}>
              <View style={styles.flex}>
                <Text style={styles.toggleLabel}>NearBaz Rider Delivery</Text>
                <Text style={styles.toggleHint}>Use platform riders — fee set by distance</Text>
              </View>
              <Switch value={platformDeliveryEnabled} onValueChange={setPlatformDeliveryEnabled} trackColor={{ false: theme.color.borderStrong, true: theme.color.primary }} thumbColor={theme.color.white} />
            </View>
            <View style={styles.toggleRow}>
              <View style={styles.flex}>
                <Text style={styles.toggleLabel}>Allow Self-Pickup</Text>
                <Text style={styles.toggleHint}>Customer collects from shop — no delivery fee</Text>
              </View>
              <Switch value={selfPickupEnabled} onValueChange={setSelfPickupEnabled} trackColor={{ false: theme.color.borderStrong, true: theme.color.primary }} thumbColor={theme.color.white} />
            </View>
            {platformDeliveryEnabled && (
              <Banner tone="info" title="Distance-based fee" message="Delivery fee is auto-calculated per km by city admin. Your manual delivery fee is not used for rider orders." />
            )}
            <View style={styles.row}>
              {!platformDeliveryEnabled && (
                <View style={styles.flex}>
                  <Field label={t.register.deliveryFee} placeholder="0" keyboardType="decimal-pad" value={deliveryFee} onChangeText={setDeliveryFee} />
                </View>
              )}
              <View style={styles.flex}>
                <Field label={t.register.minOrder} placeholder="0" keyboardType="decimal-pad" value={minOrder} onChangeText={setMinOrder} />
              </View>
            </View>
            {!platformDeliveryEnabled && (
              <Field label={t.register.freeAbove} placeholder={t.register.freeAbovePlaceholder} keyboardType="decimal-pad" value={freeAbove} onChangeText={setFreeAbove} />
            )}

            {/* Coupons */}
            {cityOffers.length > 0 && (
              <View style={{ gap: theme.space.sm }}>
                <Text style={styles.toggleLabel}>Coupons</Text>
                <Text style={styles.toggleHint}>Select which city offer templates to activate for your shop. Customers choose at checkout.</Text>
                <View style={styles.offerChips}>
                  {cityOffers.map(offer => {
                    const selected = activeOfferIds.includes(offer.id);
                    return (
                      <Pressable
                        key={offer.id}
                        style={[styles.offerChip, selected && styles.offerChipActive]}
                        onPress={() => setActiveOfferIds(prev => selected ? prev.filter(id => id !== offer.id) : [...prev, offer.id])}
                      >
                        <Text style={[styles.offerChipTxt, selected && styles.offerChipTxtActive]}>
                          {offer.title}
                        </Text>
                        {offer.minOrderPaise > 0 && <Text style={styles.offerChipMeta}>Min ₹{offer.minOrderPaise / 100}</Text>}
                      </Pressable>
                    );
                  })}
                </View>
                {activeOfferIds.length > 0 && (
                  <Text style={styles.offerActiveNote}>{activeOfferIds.length} coupon{activeOfferIds.length > 1 ? 's' : ''} will go live once your KYC is approved</Text>
                )}
              </View>
            )}

            <Banner tone="info" title={t.register.whatNext} message="After registering, complete KYC in the next step or do it later from Settings." />
            <Banner tone="warning" title={t.register.feeTitle} message={t.register.feeBody} />
          </View>
        </Card>
      )}

      {/* Step 4 — KYC (matches Settings › KYC & Verification) */}
      {step === 4 && (
        <Card>
          <Banner tone="success" title="Shop registered!" message="Complete KYC to go live, or skip and do it later from Settings › KYC & Verification." />
          <View style={{ gap: theme.space.md, marginTop: theme.space.md }}>
            <Field label={t.settings.aadhaarPan} placeholder={t.settings.aadhaarPanPlaceholder} autoCapitalize="characters" value={aadhaarPan} onChangeText={setAadhaarPan} />
            <Field label={t.settings.gstOrLicence} placeholder={t.settings.gstOrLicencePlaceholder} value={gstOrLicence} onChangeText={setGstOrLicence} />
            <Field label={t.settings.fssai} placeholder={t.settings.fssaiPlaceholder} value={fssai} onChangeText={setFssai} />
            <ImagePicker label={t.settings.bankProof} value={bankProofUrl.trim() || null} onUploaded={setBankProofUrl} hint={t.settings.bankProofHint} uploadType="kyc" />
          </View>
        </Card>
      )}

      {error ? <ErrorText>{error}</ErrorText> : null}

      {/* Navigation */}
      <View style={styles.navRow}>
        {step > 1 && step < 4 ? (
          <Button label={t.register.back} variant="outline" onPress={() => goTo((step - 1) as 1 | 2 | 3)} style={styles.navBack} />
        ) : step === 4 ? null : <View style={styles.navBack} />}

        {step < 3 ? (
          <Button
            label={t.register.next}
            onPress={() => goTo((step + 1) as 2 | 3)}
            disabled={step === 1 ? name.trim().length < 2 : (cityNotServiceable || (cityTrimmed.length === 0 && serviceable !== null && serviceable.length > 0))}
            style={styles.navNext}
          />
        ) : step === 3 ? (
          <Button label={t.register.registerShop} variant="primary" onPress={submit} busy={busy} disabled={name.trim().length < 2 || cityNotServiceable} style={styles.navNext} />
        ) : (
          <View style={styles.navNext}>
            <Button label="Submit KYC" variant="primary" onPress={submitKyc} busy={busy} disabled={aadhaarPan.trim().length < 4 || gstOrLicence.trim().length < 2} />
            <Button label="Skip — do later from Settings" variant="outline" small onPress={async () => { const shop = (await api.myShop()) as MyShop; onRegistered(shop); }} />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: theme.space.xs },
  title: { fontSize: theme.font.h1, fontWeight: '900', color: theme.color.text },
  subtitle: { fontSize: theme.font.body, color: theme.color.textMuted },
  preview: { width: '100%', height: 150, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt },
  mapLabel: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  mapHint: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: -theme.space.xs },
  row: { flexDirection: 'row', gap: theme.space.sm },
  flex: { flex: 1 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  toggleLabel: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text },
  toggleHint: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  fieldLabel: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.text, marginBottom: 4 },
  dropdown: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.md, padding: theme.space.sm, backgroundColor: theme.color.surface },
  dropdownValue: { flex: 1, fontSize: theme.font.body, color: theme.color.text },
  dropdownArrow: { fontSize: 12, color: theme.color.textMuted },
  dropdownList: { borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.md, backgroundColor: theme.color.surface, marginTop: 2, overflow: 'hidden' },
  dropdownItem: { padding: theme.space.sm },
  dropdownItemActive: { backgroundColor: theme.color.primarySoft },
  dropdownItemText: { fontSize: theme.font.body, color: theme.color.text },
  dropdownItemTextActive: { color: theme.color.primary, fontWeight: '700' },
  navRow: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.md },
  navBack: { flex: 1 },
  navNext: { flex: 2, gap: theme.space.sm },
  offerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  offerChip: { paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  offerChipActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  offerChipTxt: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.text },
  offerChipTxtActive: { color: '#fff' },
  offerChipMeta: { fontSize: 11, color: theme.color.textMuted, marginTop: 2 },
  offerActiveNote: { fontSize: theme.font.small, color: theme.color.success, fontWeight: '600' },
});
