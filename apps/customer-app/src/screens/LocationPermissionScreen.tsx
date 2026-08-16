import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { ensureLocationPermission, getCurrentCoords } from '../geo';

interface Props {
  onGranted: () => void;
  name?: string;
}

export function LocationPermissionScreen({ onGranted, name }: Props) {
  const [denied, setDenied] = useState(false);

  async function requestLocation() {
    setDenied(false);
    const ok = await ensureLocationPermission();
    if (!ok) {
      // Web: no geolocation API — let through (fallback uses default coords).
      // Native: permission not granted — guide the user to settings.
      if (Platform.OS === 'web') { onGranted(); return; }
      setDenied(true);
      return;
    }
    // Permission granted. Try to get a fix, but do NOT dead-end if the GPS read
    // times out — permission is what gates entry; downstream falls back to a
    // default/last-known location. A slow or failed fix must not trap the user
    // on this screen forever.
    void getCurrentCoords({ timeoutMs: 12000 });
    onGranted();
  }

  return (
    <View style={s.root}>
      <View style={s.illustArea}>
        <View style={s.pins}>
          <View style={s.pinLarge}>
            <View style={s.pinBody}><View style={s.pinDot} /></View>
            <View style={s.pinBase} />
          </View>
          <View style={s.dashRow}>
            {[0,1,2,3,4,5].map(i => <View key={i} style={s.dash} />)}
          </View>
          <View style={s.pinSmall}>
            <View style={s.pinBodySm}><View style={s.pinDotSm} /></View>
            <View style={s.pinBaseSm} />
          </View>
        </View>
      </View>

      <View style={s.textArea}>
        <Text style={s.title}>Hi{name ? ` ${name}` : ''}!{'\n'}Nice to meet you</Text>
        <Text style={s.sub}>
          Your location is needed to show{'\n'}nearby shops and delivery options.
        </Text>
        {denied ? (
          <Text style={s.denied}>
            Location denied. Please allow location access in your browser/device settings and try again.
          </Text>
        ) : null}
      </View>

      <View style={s.footer}>
        <Pressable style={s.btn} onPress={requestLocation}>
          <Text style={s.btnText}>Use current location</Text>
        </Pressable>
        <Text style={s.note}>Location is required to use NearBaz</Text>
      </View>
    </View>
  );
}

const PIN_RED = '#F04F4F';
const PIN_GOLD = '#F5A623';
const DASH_BLUE = '#4A90D9';

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 60 },

  illustArea: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%' },
  pins: { flexDirection: 'row', alignItems: 'flex-end', gap: 0 },

  pinLarge: { alignItems: 'center', marginBottom: 8 },
  pinBody: {
    width: 64, height: 80,
    backgroundColor: PIN_RED,
    borderRadius: 32,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: PIN_RED,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  pinDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  pinBase: { width: 24, height: 12, backgroundColor: PIN_GOLD, borderRadius: 6, marginTop: -2 },

  dashRow: { flexDirection: 'row', gap: 4, alignItems: 'center', marginHorizontal: 4, marginBottom: 16 },
  dash: { width: 10, height: 3, borderRadius: 2, backgroundColor: DASH_BLUE, opacity: 0.7 },

  pinSmall: { alignItems: 'center', marginBottom: 0 },
  pinBodySm: {
    width: 50, height: 62,
    backgroundColor: PIN_RED,
    borderRadius: 25,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: PIN_RED,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  pinDotSm: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' },
  pinBaseSm: { width: 18, height: 9, backgroundColor: PIN_GOLD, borderRadius: 5, marginTop: -1 },

  textArea: { alignItems: 'center', gap: 10, paddingHorizontal: 32 },
  title: { fontSize: 26, fontWeight: '900', color: '#111', textAlign: 'center' },
  sub: { fontSize: 15, color: '#888', textAlign: 'center', lineHeight: 22 },
  denied: { fontSize: 13, color: '#DC2626', textAlign: 'center', lineHeight: 18, marginTop: 4 },

  footer: { width: '100%', paddingHorizontal: 32, gap: 8 },
  btn: {
    borderWidth: 2,
    borderColor: PIN_GOLD,
    borderRadius: 30,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnText: { color: PIN_GOLD, fontSize: 16, fontWeight: '800' },
  note: { color: '#BBB', fontSize: 12, textAlign: 'center' },
});
