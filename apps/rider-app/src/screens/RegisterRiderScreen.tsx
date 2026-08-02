import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { theme } from '../theme';
import { Banner, Button, Card, ErrorText, Field, Screen } from '../ui';
import { LanguagePicker } from '../components/LanguagePicker';
import { useLang } from '../i18n/LanguageContext';

/**
 * RegisterRiderScreen — a logged-in user (CUSTOMER by default) becomes a
 * delivery partner. Collects a display name + an optional vehicle, calls
 * registerRider, then installs the returned RIDER-scoped token so subsequent
 * calls are authorised as a rider. On success onRegistered() is called.
 */
export function RegisterRiderScreen({ onRegistered }: { onRegistered: () => void }) {
  const [name, setName] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLang();

  async function submit() {
    if (name.trim().length < 2) {
      setError(t.register.enterName);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { accessToken } = await api.registerRider({
        name: name.trim(),
        vehicle: vehicle.trim() || undefined,
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
            label={t.register.vehicleLabel}
            placeholder={t.register.vehiclePlaceholder}
            value={vehicle}
            onChangeText={setVehicle}
            hint={t.register.vehicleHint}
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
        disabled={name.trim().length < 2}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: theme.space.xs },
  title: { fontSize: theme.font.h1, fontWeight: '900', color: theme.color.text },
  subtitle: { fontSize: theme.font.body, color: theme.color.textMuted },
});
