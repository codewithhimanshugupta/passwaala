import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLang } from '../i18n/LanguageContext';
import type { Lang } from '../i18n/strings';

const BRAND = '#5B5FC7';
const BRAND_DARK = '#4A4FB5';
const BRAND_LIGHT = '#EEEFFD';

interface LangOption { code: Lang; name: string; native: string; flag: string; }

const OPTIONS: LangOption[] = [
  { code: 'en', name: 'English', native: 'English', flag: 'EN' },
  { code: 'hi', name: 'Hindi', native: 'हिंदी', flag: 'हि' },
];

export function LanguagePickerScreen({ onContinue }: { onContinue: () => void }) {
  const { lang, setLang } = useLang();
  const [selected, setSelected] = useState<Lang>(lang);

  function handleContinue() {
    setLang(selected);
    onContinue();
  }

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Purple banner */}
        <View style={s.banner}>
          <View style={s.bannerText}>
            <Text style={s.bannerTitle}>Choose Your{'\n'}Language</Text>
            <Text style={s.bannerSub}>We'll personalize your{'\n'}experience accordingly.</Text>
          </View>
        </View>

        {/* Label row */}
        <View style={s.labelRow}>
          <Text style={s.labelText}>Select Language</Text>
        </View>

        {/* Language options */}
        <View style={s.list}>
          {OPTIONS.map((opt) => {
            const active = selected === opt.code;
            return (
              <Pressable
                key={opt.code}
                style={[s.row, active && s.rowActive]}
                onPress={() => setSelected(opt.code)}
              >
                <View style={s.flagCircle}>
                  <Text style={s.flagText}>{opt.flag}</Text>
                </View>
                <View style={s.rowInfo}>
                  <Text style={[s.rowName, active && s.rowNameActive]}>{opt.name}</Text>
                  <Text style={[s.rowNative, active && s.rowNativeActive]}>{opt.native}</Text>
                </View>
                <View style={[s.radio, active && s.radioActive]} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Continue button pinned to bottom */}
      <View style={s.footer}>
        <Pressable style={s.btn} onPress={handleContinue}>
          <Text style={s.btnText}>CONTINUE</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F7FB' },
  scroll: { paddingBottom: 120 },

  banner: {
    backgroundColor: BRAND,
    margin: 16,
    borderRadius: 20,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  bannerText: { flex: 1, gap: 6 },
  bannerTitle: { color: '#fff', fontSize: 24, fontWeight: '900', lineHeight: 30 },
  bannerSub: { color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 19 },
  bannerGlobe: {
    fontSize: 52,
    opacity: 0.85,
    marginLeft: 12,
  },

  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  labelIcon: { fontSize: 18 },
  labelText: { flex: 1, fontSize: 16, fontWeight: '700', color: '#222' },
  flagBadge: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  flagBadgeText: { fontSize: 18 },

  list: { paddingHorizontal: 16, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    gap: 14,
    borderWidth: 1.5,
    borderColor: '#EEE',
  },
  rowActive: {
    borderColor: BRAND,
    backgroundColor: BRAND_LIGHT,
  },
  flagCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F0F0F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagText: { fontSize: 26 },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { fontSize: 16, fontWeight: '700', color: '#222' },
  rowNameActive: { color: BRAND },
  rowNative: { fontSize: 13, color: '#888' },
  rowNativeActive: { color: BRAND, opacity: 0.75 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#CCC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { backgroundColor: BRAND, borderColor: BRAND },
  radioCheck: { color: '#fff', fontSize: 13, fontWeight: '900' },

  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 24,
    backgroundColor: '#F6F7FB',
    borderTopWidth: 1,
    borderTopColor: '#EEE',
  },
  btn: {
    backgroundColor: BRAND,
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: BRAND_DARK,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
});
