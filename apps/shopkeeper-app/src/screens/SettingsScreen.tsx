import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { VerificationStatus } from '@passwaala/shared';
import { api, logout, updateName, type MyAccount } from '../api';
import { paiseToRupeeInput, placeholderImage, rupeeInputToPaise, theme } from '../theme';
import { Badge, Banner, Button, Card, ErrorText, Field, Screen, SectionTitle } from '../ui';
import { ImagePicker } from '../components/ImagePicker';
import { LanguagePicker } from '../components/LanguagePicker';
import { UpiQrScanner } from '../components/UpiQrScanner';
import { verificationMeta } from '../status';
import { useLang } from '../i18n/LanguageContext';
import type { Strings } from '../i18n/strings';
import type { MyShop, WorkingHours } from '../types';

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function dayLabel(key: DayKey, t: Strings): string {
  return t.settings.days[key];
}

const DEFAULT_OPEN = '09:00';
const DEFAULT_CLOSE = '21:00';

type DayHours = { open: string; close: string; enabled: boolean };

function initHours(saved?: WorkingHours): Record<string, DayHours> {
  const out: Record<string, DayHours> = {};
  for (const key of DAY_KEYS) {
    const s = saved?.[key];
    out[key] = { open: s?.open ?? DEFAULT_OPEN, close: s?.close ?? DEFAULT_CLOSE, enabled: !!s };
  }
  return out;
}

function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t.trim());
}

function SectionHeader({ title, expanded, onToggle }: { title: string; expanded: boolean; onToggle: () => void }) {
  return (
    <Pressable style={styles.sectionHeader} onPress={onToggle}>
      <Text style={styles.sectionHeaderText}>{title}</Text>
      <Text style={styles.sectionChevron}>{expanded ? '▲' : '▼'}</Text>
    </Pressable>
  );
}

export function SettingsScreen({
  shop,
  onShopChange,
  onKycSubmitted,
}: {
  shop: MyShop;
  onShopChange: (shop: MyShop) => void;
  onKycSubmitted: (status: VerificationStatus) => void;
}) {
  const { t } = useLang();

  // Section expand state — Delivery and Coupons default open, others closed
  const [showShop, setShowShop] = useState(false);
  const [showDelivery, setShowDelivery] = useState(true);
  const [showCoupons, setShowCoupons] = useState(true);
  const [showHours, setShowHours] = useState(false);
  const [showKyc, setShowKyc] = useState(false);

  // Delivery options
  const [upiVpa, setUpiVpa] = useState(shop.upiVpa ?? '');
  const [deliveryFee, setDeliveryFee] = useState(paiseToRupeeInput(shop.deliveryFeePaise));
  const [freeAbove, setFreeAbove] = useState(paiseToRupeeInput(shop.freeDeliveryAbovePaise));
  const [minOrder, setMinOrder] = useState(paiseToRupeeInput(shop.minOrderValuePaise));
  const [platformDeliveryEnabled, setPlatformDeliveryEnabled] = useState(!!shop.platformDeliveryEnabled);
  const [selfPickupEnabled, setSelfPickupEnabled] = useState(shop.selfPickupEnabled !== false);

  // Coupons
  const [activeOfferIds, setActiveOfferIds] = useState<string[]>(() => {
    const offerId = (shop as { activeOfferId?: string | null }).activeOfferId;
    const couponIds = (shop as { activeCouponIds?: string[] }).activeCouponIds ?? [];
    return [...(offerId ? [offerId] : []), ...couponIds];
  });
  const [cityOffers, setCityOffers] = useState<Array<{ id: string; title: string; type: string; value: number; minOrderPaise: number }>>([]);
  const [offerStats, setOfferStats] = useState<Record<string, number>>({});

  // Working hours
  const [hours, setHours] = useState<Record<string, DayHours>>(() => initHours(shop.workingHours));

  // Shop contact (UPI + address) — editable but separate from registration
  const [addressLine, setAddressLine] = useState(shop.addressLine ?? '');
  const [contactPhone, setContactPhone] = useState(shop.contactPhone ?? '');

  // Tax / legal identity (all optional)
  const [gstin, setGstin] = useState(shop.gstin ?? '');
  const [stateCode, setStateCode] = useState(shop.stateCode ?? '');
  const [legalName, setLegalName] = useState(shop.legalName ?? '');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [upiScanError, setUpiScanError] = useState<string | null>(null);

  useEffect(() => {
    if (!shop.city) return;
    api.serviceableCities().then((cities) => {
      const shopCity = shop.city?.toLowerCase() ?? '';
      const city = cities.find(c =>
        shopCity.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(shopCity)
      );
      if (city) setCityOffers(city.offers);
    }).catch(() => {});
    api.myOfferStats().then((stats) => {
      const map: Record<string, number> = {};
      for (const s of stats) map[s.offerId] = s.usedCount;
      setOfferStats(map);
    }).catch(() => {});
  }, [shop.city]);

  function setDay(day: string, patch: Partial<DayHours>) {
    setSaved(false);
    setHours((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
  }

  async function save() {
    for (const key of DAY_KEYS) {
      const h = hours[key];
      if (h.enabled && (!isValidTime(h.open) || !isValidTime(h.close))) {
        setSaveError(t.settings.timeError(dayLabel(key, t)));
        return;
      }
    }
    const workingHours: WorkingHours = {};
    for (const key of DAY_KEYS) {
      const h = hours[key];
      if (h.enabled) workingHours[key] = { open: h.open.trim(), close: h.close.trim() };
    }
    setSaving(true); setSaveError(null); setSaved(false);
    try {
      await api.updateShopSettings({
        addressLine: addressLine.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        upiVpa: upiVpa.trim() || undefined,
        gstin: gstin.trim() || undefined,
        stateCode: stateCode.trim() || undefined,
        legalName: legalName.trim() || undefined,
        deliveryFeePaise: rupeeInputToPaise(deliveryFee),
        freeDeliveryAbovePaise: freeAbove.trim() ? rupeeInputToPaise(freeAbove) : undefined,
        minOrderValuePaise: rupeeInputToPaise(minOrder),
        platformDeliveryEnabled,
        selfPickupEnabled,
        activeOfferIds,
        workingHours,
      });
      onShopChange({ ...shop, addressLine: addressLine.trim() || undefined, contactPhone: contactPhone.trim() || undefined, upiVpa: upiVpa.trim() || undefined, gstin: gstin.trim() || undefined, stateCode: stateCode.trim() || undefined, legalName: legalName.trim() || undefined, deliveryFeePaise: rupeeInputToPaise(deliveryFee), freeDeliveryAbovePaise: freeAbove.trim() ? rupeeInputToPaise(freeAbove) : undefined, minOrderValuePaise: rupeeInputToPaise(minOrder), platformDeliveryEnabled, selfPickupEnabled, workingHours });
      setSaved(true);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      {/* 1. Account */}
      <ProfileSection />

      {/* 2. Shop open/close + contact */}
      <Card style={styles.sectionCard}>
        <SectionHeader title="Shop" expanded={showShop} onToggle={() => setShowShop(v => !v)} />
        {showShop && (
          <View style={styles.sectionBody}>
            <View style={styles.toggleRow}>
              <View style={styles.flex}>
                <Text style={styles.toggleLabel}>{shop.isOpen ? 'Open — accepting orders' : 'Closed — not accepting orders'}</Text>
              </View>
              <Switch
                value={shop.isOpen}
                onValueChange={async (v) => {
                  // Optimistic: flip immediately; reconcile with the server's echo,
                  // roll back + surface an error if the call fails.
                  const prev = shop.isOpen;
                  onShopChange({ ...shop, isOpen: v });
                  setSaveError(null);
                  try {
                    const res = await api.setStoreOpen(v);
                    onShopChange({ ...shop, isOpen: res.isOpen });
                  } catch (e) {
                    onShopChange({ ...shop, isOpen: prev });
                    setSaveError((e as Error).message);
                  }
                }}
                trackColor={{ false: theme.color.borderStrong, true: theme.color.primary }}
                thumbColor={theme.color.white}
              />
            </View>
            <Field label="Address" placeholder="Shop address" value={addressLine} onChangeText={(v) => { setSaved(false); setAddressLine(v); }} />
            <Field label="Contact Phone" placeholder="Public contact number" keyboardType="phone-pad" maxLength={15} value={contactPhone} onChangeText={(v) => { setSaved(false); setContactPhone(v); }} />
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Field label="UPI ID" placeholder="yourshop@upi" autoCapitalize="none" value={upiVpa} onChangeText={(v) => { setSaved(false); setUpiScanError(null); setUpiVpa(v); }} hint="Customers pay to this UPI ID" />
                </View>
                <UpiQrScanner
                  onScan={(vpa) => { setSaved(false); setUpiScanError(null); setUpiVpa(vpa); }}
                  onError={(msg) => setUpiScanError(msg)}
                />
              </View>
              {upiScanError ? <Text style={{ fontSize: 12, color: theme.color.danger }}>{upiScanError}</Text> : null}
            </View>
            {!upiVpa.trim() && <Banner tone="warning" title="UPI not set" message="Customers won't be able to pay by UPI QR." />}
            <Field label="GSTIN" placeholder="15-character GSTIN" autoCapitalize="characters" maxLength={15} value={gstin} onChangeText={(v) => { setSaved(false); setGstin(v); }} hint="Optional — for GST-registered shops" />
            <Field label="State Code" placeholder="e.g. 27" keyboardType="number-pad" maxLength={2} value={stateCode} onChangeText={(v) => { setSaved(false); setStateCode(v); }} hint="Optional — 2-digit GST state code" />
            <Field label="Legal Name" placeholder="Registered legal name" value={legalName} onChangeText={(v) => { setSaved(false); setLegalName(v); }} hint="Optional — as registered for GST" />
          </View>
        )}
      </Card>

      {/* 3. Delivery Options */}
      <Card style={styles.sectionCard}>
        <SectionHeader title="Delivery Options" expanded={showDelivery} onToggle={() => setShowDelivery(v => !v)} />
        {showDelivery && (
          <View style={styles.sectionBody}>
            <View style={styles.toggleRow}>
              <View style={styles.flex}>
                <Text style={styles.toggleLabel}>PassWaala Rider Delivery</Text>
                <Text style={styles.toggleHint}>Use platform riders for delivery — fee set by distance</Text>
              </View>
              <Switch value={platformDeliveryEnabled} onValueChange={(v) => { setSaved(false); setPlatformDeliveryEnabled(v); }} trackColor={{ false: theme.color.borderStrong, true: theme.color.primary }} thumbColor={theme.color.white} />
            </View>
            <View style={styles.toggleRow}>
              <View style={styles.flex}>
                <Text style={styles.toggleLabel}>Allow Self-Pickup</Text>
                <Text style={styles.toggleHint}>Customer collects from shop — no delivery fee</Text>
              </View>
              <Switch value={selfPickupEnabled} onValueChange={(v) => { setSaved(false); setSelfPickupEnabled(v); }} trackColor={{ false: theme.color.borderStrong, true: theme.color.primary }} thumbColor={theme.color.white} />
            </View>
            {platformDeliveryEnabled && (
              <Banner tone="info" title="Distance-based fee" message="Delivery fee is auto-calculated per km (set by city admin). Your manual delivery fee is not used for rider orders." />
            )}
            <View style={styles.row}>
              {!platformDeliveryEnabled && (
                <View style={styles.flex}>
                  <Field label={t.settings.deliveryFee} placeholder="0" keyboardType="decimal-pad" value={deliveryFee} onChangeText={(v) => { setSaved(false); setDeliveryFee(v); }} />
                </View>
              )}
              <View style={styles.flex}>
                <Field label={t.settings.minOrder} placeholder="0" keyboardType="decimal-pad" value={minOrder} onChangeText={(v) => { setSaved(false); setMinOrder(v); }} />
              </View>
            </View>
            {!platformDeliveryEnabled && (
              <Field label={t.settings.freeAbove} placeholder={t.settings.freeAbovePlaceholder} keyboardType="decimal-pad" value={freeAbove} onChangeText={(v) => { setSaved(false); setFreeAbove(v); }} hint={t.settings.freeAboveHint} />
            )}
          </View>
        )}
      </Card>

      {/* 4. Coupons */}
      <Card style={styles.sectionCard}>
        <SectionHeader title={`Coupons${activeOfferIds.length > 0 ? ` (${activeOfferIds.length} active)` : ''}`} expanded={showCoupons} onToggle={() => setShowCoupons(v => !v)} />
        {showCoupons && (
          <View style={styles.sectionBody}>
            {cityOffers.length === 0 ? (
              <Text style={styles.emptyHint}>No coupons available. Ask your city admin to create offer templates.</Text>
            ) : (
              <>
                <Text style={styles.offerHint}>Select which offers customers can apply at checkout.</Text>
                <View style={styles.offerChips}>
                  {cityOffers.map(offer => {
                    const selected = activeOfferIds.includes(offer.id);
                    return (
                      <Pressable
                        key={offer.id}
                        style={[styles.offerChip, selected && styles.offerChipActive]}
                        onPress={() => { setSaved(false); setActiveOfferIds(prev => selected ? prev.filter(id => id !== offer.id) : [...prev, offer.id]); }}
                      >
                        <Text style={[styles.offerChipTxt, selected && styles.offerChipTxtActive]}>
                          {offer.title}
                        </Text>
                        {offer.minOrderPaise > 0 && <Text style={styles.offerChipMeta}>Min ₹{offer.minOrderPaise / 100}</Text>}
                        {offerStats[offer.id] > 0 && <Text style={styles.offerChipMeta}>Used {offerStats[offer.id]}× orders</Text>}
                      </Pressable>
                    );
                  })}
                </View>
                {activeOfferIds.length > 0 && (
                  <Text style={styles.offerActiveNote}>{activeOfferIds.length} coupon{activeOfferIds.length > 1 ? 's' : ''} enabled — customers pick at checkout</Text>
                )}
              </>
            )}
          </View>
        )}
      </Card>

      {/* 5. Working Hours */}
      <Card style={styles.sectionCard}>
        <SectionHeader title="Working Hours" expanded={showHours} onToggle={() => setShowHours(v => !v)} />
        {showHours && (
          <View style={styles.sectionBody}>
            <Text style={styles.toggleHint}>{t.settings.workingHoursHint}</Text>
            {DAY_KEYS.map((key) => {
              const h = hours[key];
              return (
                <View key={key} style={styles.dayRow}>
                  <Pressable onPress={() => setDay(key, { enabled: !h.enabled })} style={styles.dayToggle} hitSlop={6}>
                    <View style={[styles.checkbox, h.enabled && styles.checkboxOn]}>
                      {h.enabled ? <Text style={styles.checkboxTick}>✓</Text> : null}
                    </View>
                    <Text style={styles.toggleLabel}>{dayLabel(key, t)}</Text>
                  </Pressable>
                  {h.enabled ? (
                    <View style={styles.timeInputs}>
                      <TimeBox value={h.open} onChangeText={(val) => setDay(key, { open: val })} />
                      <Text style={styles.timeDash}>–</Text>
                      <TimeBox value={h.close} onChangeText={(val) => setDay(key, { close: val })} />
                    </View>
                  ) : (
                    <Text style={styles.closedText}>{t.settings.closed}</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </Card>

      {/* 6. KYC */}
      <Card style={styles.sectionCard}>
        <SectionHeader title="KYC & Verification" expanded={showKyc} onToggle={() => setShowKyc(v => !v)} />
        {showKyc && (
          <View style={styles.sectionBody}>
            <KycSection shop={shop} onSubmitted={onKycSubmitted} />
          </View>
        )}
      </Card>

      {saveError ? <ErrorText>{saveError}</ErrorText> : null}
      {saved ? <Banner tone="success" message={t.settings.settingsSaved} /> : null}
      <Button label={t.settings.saveSettings} onPress={save} busy={saving} />
    </Screen>
  );
}

function TimeBox({ value, onChangeText }: { value: string; onChangeText: (t: string) => void }) {
  return (
    <View style={styles.timeBox}>
      <Field value={value} onChangeText={onChangeText} placeholder="09:00" maxLength={5} keyboardType="default" />
    </View>
  );
}

function ProfileSection() {
  const { t } = useLang();
  const [account, setAccount] = useState<MyAccount | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.me().then(acc => {
      if (!alive) return;
      setAccount(acc as MyAccount);
      setName((acc as MyAccount).name ?? '');
    }).catch(e => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function save() {
    const trimmed = name.trim();
    if (trimmed.length < 2) { setError(t.settings.enterName); return; }
    setSaving(true); setError(null); setSaved(false);
    try {
      await updateName(trimmed);
      setAccount(prev => prev ? { ...prev, name: trimmed } : prev);
      setSaved(true);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <SectionTitle>{t.settings.partnerProfile}</SectionTitle>
      <View style={styles.sectionBody}>
        <LanguagePicker label={t.common.language} />
        <Field label={t.settings.yourName} placeholder={t.settings.yourNamePlaceholder} value={name} onChangeText={(v) => { setSaved(false); setName(v); }} />
        <Text style={styles.readonly}>{t.settings.phone(loading ? '…' : account?.phone ?? '—')}</Text>
        <View style={styles.coinRow}>
          <Text style={styles.coinLabel}>{t.settings.coinBalance}</Text>
          <Badge label={`${loading ? '…' : account?.coinBalance ?? 0}`} tone="accent" />
        </View>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {saved ? <Banner tone="success" message={t.settings.nameSaved} /> : null}
        <Button label={t.settings.saveName} onPress={save} busy={saving} />
        <Button label={t.common.logout} variant="outline" onPress={logout} />
      </View>
    </Card>
  );
}

function KycSection({ shop, onSubmitted }: { shop: MyShop; onSubmitted: (status: VerificationStatus) => void }) {
  const { t } = useLang();
  const [aadhaarPan, setAadhaarPan] = useState('');
  const [gstOrLicence, setGstOrLicence] = useState('');
  const [fssai, setFssai] = useState('');
  const [bankProofUrl, setBankProofUrl] = useState('');
  const [docUrls, setDocUrls] = useState<string[]>(['']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = verificationMeta(shop.verificationStatus, t);
  const canSubmit = shop.verificationStatus === VerificationStatus.DRAFT || shop.verificationStatus === VerificationStatus.REJECTED;

  function updateDoc(index: number, value: string) { setDocUrls(prev => prev.map((d, i) => i === index ? value : d)); }
  function addDoc() { if (docUrls.length < 3) setDocUrls(prev => [...prev, '']); }
  function removeDoc(index: number) { setDocUrls(prev => prev.filter((_, i) => i !== index)); }

  async function submit() {
    if (aadhaarPan.trim().length < 4) { setError(t.settings.enterAadhaarPan); return; }
    if (gstOrLicence.trim().length < 2) { setError(t.settings.enterGstOrLicence); return; }
    const bank = bankProofUrl.trim() || `https://picsum.photos/seed/${shop.id}-bank/600/400`;
    let docs = docUrls.map(d => d.trim()).filter(Boolean);
    if (!docs.length) docs = [`https://picsum.photos/seed/${shop.id}-doc1/600/400`];
    setBusy(true); setError(null);
    try {
      await api.submitKyc({ aadhaarPan: aadhaarPan.trim(), gstOrLicence: gstOrLicence.trim(), fssai: fssai.trim() || undefined, bankProofUrl: bank, docUrls: docs });
      onSubmitted(VerificationStatus.PENDING_REVIEW);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <View style={styles.kycStatusRow}>
        <Text style={styles.readonly}>{t.settings.verificationStatus}</Text>
        <Badge label={meta.label} tone={meta.tone} />
      </View>
      {!canSubmit ? (
        <Banner
          tone={shop.verificationStatus === VerificationStatus.APPROVED ? 'success' : 'info'}
          title={shop.verificationStatus === VerificationStatus.APPROVED ? t.settings.verifiedTitle : t.settings.alreadySubmittedTitle}
          message={shop.verificationStatus === VerificationStatus.APPROVED ? t.settings.verifiedBody : t.settings.alreadySubmittedBody}
        />
      ) : (
        <>
          <Banner tone="info" message={t.settings.kycIntro} />
          <Field label={t.settings.aadhaarPan} placeholder={t.settings.aadhaarPanPlaceholder} autoCapitalize="characters" value={aadhaarPan} onChangeText={setAadhaarPan} />
          <Field label={t.settings.gstOrLicence} placeholder={t.settings.gstOrLicencePlaceholder} value={gstOrLicence} onChangeText={setGstOrLicence} />
          <Field label={t.settings.fssai} placeholder={t.settings.fssaiPlaceholder} value={fssai} onChangeText={setFssai} />
          <ImagePicker label={t.settings.bankProof} value={bankProofUrl.trim() || null} onUploaded={setBankProofUrl} hint={t.settings.bankProofHint} uploadType="kyc" scopeId={shop.id} />
          {docUrls.map((doc, i) => (
            <View key={i} style={styles.docRow}>
              <View style={styles.flex}>
                <ImagePicker label={t.settings.document(i + 1)} value={doc.trim() || null} onUploaded={(url) => updateDoc(i, url)} uploadType="kyc" scopeId={shop.id} />
              </View>
              {docUrls.length > 1 && <Pressable onPress={() => removeDoc(i)} style={styles.removeDoc} hitSlop={8}><Text style={styles.removeDocText}>{t.settings.remove}</Text></Pressable>}
            </View>
          ))}
          {docUrls.length < 3 && <Button label={t.settings.addDocument} variant="outline" small onPress={addDoc} />}
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button label={t.settings.submitForReview} onPress={submit} busy={busy} />
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  header: { paddingBottom: theme.space.sm },
  title: { fontSize: theme.font.h1, fontWeight: '800', color: theme.color.text },

  sectionCard: { padding: 0, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', padding: theme.space.md },
  sectionHeaderText: { flex: 1, fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  sectionChevron: { fontSize: 12, color: theme.color.textMuted },
  sectionBody: { paddingHorizontal: theme.space.md, paddingBottom: theme.space.md, gap: theme.space.sm },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, paddingVertical: theme.space.xs },
  toggleLabel: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text },
  toggleHint: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: theme.space.sm },

  // Coupons
  offerHint: { fontSize: theme.font.small, color: theme.color.textMuted },
  offerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  offerChip: { paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  offerChipActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  offerChipTxt: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.text },
  offerChipTxtActive: { color: '#fff' },
  offerChipMeta: { fontSize: 11, color: theme.color.textMuted, marginTop: 2 },
  offerActiveNote: { fontSize: theme.font.small, color: theme.color.success, fontWeight: '600' },
  emptyHint: { fontSize: theme.font.small, color: theme.color.textMuted, fontStyle: 'italic' },

  // Working hours
  dayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: theme.space.xs },
  dayToggle: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, flex: 1 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  checkboxTick: { color: '#fff', fontSize: 12, fontWeight: '800' },
  timeInputs: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeBox: { width: 72 },
  timeDash: { color: theme.color.textMuted, fontSize: theme.font.body },
  closedText: { fontSize: theme.font.small, color: theme.color.textMuted, fontStyle: 'italic' },

  // KYC
  kycStatusRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, marginBottom: theme.space.sm },
  docRow: { flexDirection: 'row', alignItems: 'flex-end', gap: theme.space.sm },
  removeDoc: { paddingBottom: theme.space.xs },
  removeDocText: { fontSize: theme.font.small, color: theme.color.danger, fontWeight: '600' },

  // Profile
  readonly: { fontSize: theme.font.small, color: theme.color.textMuted },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  coinLabel: { fontSize: theme.font.small, color: theme.color.textMuted },
});
