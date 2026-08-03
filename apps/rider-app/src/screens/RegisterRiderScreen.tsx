import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { theme } from '../theme';
import { Banner, Button, Card, ErrorText, Field, Screen, SectionTitle } from '../ui';
import { LanguagePicker } from '../components/LanguagePicker';
import { useLang } from '../i18n/LanguageContext';

/** Loose Aadhaar check: 12 digits once spaces are stripped. */
function isValidAadhaar(raw: string): boolean {
  return /^\d{12}$/.test(raw.replace(/\s+/g, ''));
}

/**
 * RegisterRiderScreen — a logged-in user (CUSTOMER by default) becomes a
 * delivery partner. Collects a display name, service city, an optional vehicle,
 * and the KYC details (identity + documents) an admin needs to verify the
 * partner, then calls registerRider and installs the returned RIDER-scoped token
 * so subsequent calls are authorised as a rider. On success onRegistered() is
 * called. Text-only — the rider app has no image picker, so photoUrl/docUrls
 * are left unsent.
 */
export function RegisterRiderScreen({ onRegistered }: { onRegistered: () => void }) {
  const [name, setName] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [serviceCity, setServiceCity] = useState('Jhansi');

  // KYC. fullName mirrors `name` until the rider edits it themselves.
  const [fullName, setFullName] = useState('');
  const [fullNameTouched, setFullNameTouched] = useState(false);
  const [aadhaar, setAadhaar] = useState('');
  const [pan, setPan] = useState('');
  const [dlNumber, setDlNumber] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLang();

  // The account already has a name from signup — prefill it so the rider
  // doesn't retype it here (the KYC full name mirrors `name` until edited).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const account = (await api.me()) as { name?: string | null };
        if (!cancelled && account?.name) setName(account.name);
      } catch {
        // Non-fatal: fall back to an empty field the rider fills in.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fullNameValue = fullNameTouched ? fullName : name;
  const canSubmit =
    name.trim().length >= 2 &&
    serviceCity.trim().length > 0 &&
    isValidAadhaar(aadhaar) &&
    dlNumber.trim().length > 0;

  async function submit() {
    if (name.trim().length < 2) {
      setError(t.register.enterName);
      return;
    }
    if (serviceCity.trim().length === 0) {
      setError(t.register.enterCity);
      return;
    }
    if (!isValidAadhaar(aadhaar)) {
      setError(t.register.enterAadhaar);
      return;
    }
    if (dlNumber.trim().length === 0) {
      setError(t.register.enterDl);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { accessToken } = await api.registerRider({
        name: name.trim(),
        vehicle: vehicle.trim() || undefined,
        serviceCity: serviceCity.trim() || undefined,
        fullName: fullNameValue.trim() || undefined,
        aadhaar: aadhaar.trim() || undefined,
        pan: pan.trim() || undefined,
        dlNumber: dlNumber.trim() || undefined,
        vehicleNumber: vehicleNumber.trim() || undefined,
        emergencyName: emergencyName.trim() || undefined,
        emergencyPhone: emergencyPhone.trim() || undefined,
      });
      // Switch to the new RIDER-scoped token so subsequent calls are authorised.
      api.setToken(accessToken);
      onRegistered();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <LanguagePicker label={t.common.language} />

      <View style={styles.header}>
        <Text style={styles.title}>{t.register.title}</Text>
        <Text style={styles.subtitle}>{t.register.subtitle}</Text>
      </View>

      <Card>
        <View style={{ gap: theme.space.md }}>
          <Field
            label={t.register.nameLabel}
            placeholder={t.register.namePlaceholder}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          <Field
            label={t.register.cityLabel}
            placeholder={t.register.cityPlaceholder}
            value={serviceCity}
            onChangeText={setServiceCity}
            autoCapitalize="words"
            hint={t.register.cityHint}
          />
          <Field
            label={t.register.vehicleLabel}
            placeholder={t.register.vehiclePlaceholder}
            value={vehicle}
            onChangeText={setVehicle}
            hint={t.register.vehicleHint}
          />
        </View>
      </Card>

      <Card>
        <View style={{ gap: theme.space.md }}>
          <View style={styles.sectionHeader}>
            <SectionTitle>{t.register.kycTitle}</SectionTitle>
            <Text style={styles.sectionSub}>{t.register.kycSubtitle}</Text>
          </View>
          <Field
            label={t.register.fullNameLabel}
            placeholder={t.register.fullNamePlaceholder}
            value={fullNameValue}
            onChangeText={(v) => {
              setFullNameTouched(true);
              setFullName(v);
            }}
            autoCapitalize="words"
          />
          <Field
            label={t.register.aadhaarLabel}
            placeholder={t.register.aadhaarPlaceholder}
            value={aadhaar}
            onChangeText={(v) => setAadhaar(v.replace(/\D/g, '').slice(0, 12))}
            keyboardType="number-pad"
            maxLength={12}
            hint={t.register.aadhaarHint}
          />
          <Field
            label={t.register.panLabel}
            placeholder={t.register.panPlaceholder}
            value={pan}
            onChangeText={setPan}
            autoCapitalize="characters"
            maxLength={10}
          />
          <Field
            label={t.register.dlLabel}
            placeholder={t.register.dlPlaceholder}
            value={dlNumber}
            onChangeText={setDlNumber}
            autoCapitalize="characters"
          />
          <Field
            label={t.register.vehicleNumberLabel}
            placeholder={t.register.vehicleNumberPlaceholder}
            value={vehicleNumber}
            onChangeText={setVehicleNumber}
            autoCapitalize="characters"
          />
          <Field
            label={t.register.emergencyNameLabel}
            placeholder={t.register.emergencyNamePlaceholder}
            value={emergencyName}
            onChangeText={setEmergencyName}
            autoCapitalize="words"
          />
          <Field
            label={t.register.emergencyPhoneLabel}
            placeholder={t.register.emergencyPhonePlaceholder}
            value={emergencyPhone}
            onChangeText={setEmergencyPhone}
            keyboardType="phone-pad"
            maxLength={10}
          />
        </View>
      </Card>

      <Banner
        tone="info"
        title={t.register.nextTitle}
        message={t.register.nextMessage}
      />

      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button
        label={t.register.startDelivering}
        onPress={submit}
        busy={busy}
        disabled={!canSubmit}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: theme.space.xs },
  title: { fontSize: theme.font.h1, fontWeight: '900', color: theme.color.text },
  subtitle: { fontSize: theme.font.body, color: theme.color.textMuted },
  sectionHeader: { gap: theme.space.xs },
  sectionSub: { fontSize: theme.font.small, color: theme.color.textMuted },
});
