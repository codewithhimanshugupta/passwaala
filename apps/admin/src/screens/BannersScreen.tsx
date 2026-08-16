import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError, type AdminBanner } from '@nearbaz/api-client';
import { api } from '../api';
import { theme } from '../theme';
import { DeleteIcon } from '../EditDeleteIcons';

/**
 * Open the browser's native file picker (admin is React-Native-Web) and resolve
 * with the chosen image File, or null if cancelled.
 */
function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

// ---------------------------------------------------------------------------
// Create form — upload image, target cities, order, active
// ---------------------------------------------------------------------------

function BannerForm({
  cities,
  onSave,
  onCancel,
  saving,
}: {
  cities: string[];
  onSave: (data: { imageUrl: string; cities: string[]; sortOrder: number; active: boolean }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState('0');
  const [active, setActive] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function handlePick() {
    setErr(null);
    const file = await pickImageFile();
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await api.uploadImage(file, { type: 'banner' });
      setImageUrl(url);
    } catch (e) {
      setErr(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  function toggleCity(c: string) {
    setSelectedCities((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  }

  return (
    <ScrollView style={f.root} contentContainerStyle={f.body}>
      <Text style={f.heading}>Add Home Banner</Text>

      <Text style={f.label}>Banner Image * (wide landscape, ~2:1 looks best)</Text>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={f.preview} resizeMode="cover" />
      ) : (
        <View style={f.previewEmpty}>
          <Text style={f.previewEmptyText}>No image selected</Text>
        </View>
      )}
      <Pressable style={[f.uploadBtn, uploading && f.saveBtnDim]} onPress={handlePick} disabled={uploading}>
        {uploading ? <ActivityIndicator color={theme.color.primary} /> : (
          <Text style={f.uploadBtnText}>{imageUrl ? 'Change Image' : 'Choose Image'}</Text>
        )}
      </Pressable>
      {err ? <Text style={f.err}>{err}</Text> : null}

      <Text style={f.label}>Target Cities (leave empty = show in all cities)</Text>
      <View style={f.chips}>
        {cities.length === 0 ? (
          <Text style={f.hint}>No serviceable cities found.</Text>
        ) : (
          cities.map((c) => {
            const on = selectedCities.includes(c);
            return (
              <Pressable key={c} style={[f.chip, on && f.chipOn]} onPress={() => toggleCity(c)}>
                <Text style={[f.chipText, on && f.chipTextOn]}>{c}</Text>
              </Pressable>
            );
          })
        )}
      </View>

      <View style={f.row2}>
        <View style={f.col}>
          <Text style={f.label}>Sort Order (lower shows first)</Text>
          <TextInput
            style={f.input}
            value={sortOrder}
            onChangeText={setSortOrder}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={theme.color.textFaint}
          />
        </View>
        <View style={[f.col, f.activeRow]}>
          <Text style={f.label}>Active</Text>
          <Switch
            value={active}
            onValueChange={setActive}
            trackColor={{ false: theme.color.border, true: theme.color.primary }}
            thumbColor="#fff"
          />
        </View>
      </View>

      <View style={f.actions}>
        <Pressable style={f.cancelBtn} onPress={onCancel}>
          <Text style={f.cancelBtnText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[f.saveBtn, (saving || !imageUrl) && f.saveBtnDim]}
          onPress={() => onSave({ imageUrl, cities: selectedCities, sortOrder: parseInt(sortOrder) || 0, active })}
          disabled={saving || !imageUrl}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={f.saveBtnText}>Add Banner</Text>}
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function BannersScreen() {
  const [banners, setBanners] = useState<AdminBanner[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // City-wise view: null = "All", else show only banners targeting that city
  // (plus all-cities banners, which display in every city).
  const [cityFilter, setCityFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, cityList] = await Promise.all([
        api.adminListBanners(true),
        api.serviceableCities().catch(() => []),
      ]);
      setBanners(list);
      setCities(cityList.map((c) => c.name));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  function flash(msg: string) { setBanner(msg); setTimeout(() => setBanner(null), 3000); }

  async function handleCreate(data: { imageUrl: string; cities: string[]; sortOrder: number; active: boolean }) {
    setSaving(true);
    try {
      await api.adminCreateBanner(data);
      flash('Banner added!');
      setCreating(false);
      await load();
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
    finally { setSaving(false); }
  }

  async function handleToggle(b: AdminBanner) {
    const prev = banners;
    setBanners((list) => list.map((x) => (x.id === b.id ? { ...x, active: !x.active } : x)));
    try {
      await api.adminUpdateBanner(b.id, { active: !b.active });
    } catch (e) { setBanners(prev); flash(`Error: ${(e as Error).message}`); }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    const prev = banners;
    setBanners((list) => list.filter((b) => b.id !== id));
    try {
      await api.adminDeleteBanner(id);
      flash('Banner deleted.');
    } catch (e) { setBanners(prev); flash(`Error: ${(e as Error).message}`); }
    finally { setDeleting(null); }
  }

  if (forbidden) return (
    <View style={s.center}><Text style={s.forbiddenText}>Admin access required.</Text></View>
  );

  if (creating) return (
    <BannerForm cities={cities} saving={saving} onCancel={() => setCreating(false)} onSave={handleCreate} />
  );

  // City-wise tabs: "All" + every city any banner targets. A city tab shows that
  // city's banners AND all-cities banners (empty `cities`), since those display
  // to that city's customers too.
  const bannerCities = Array.from(new Set(banners.flatMap((b) => b.cities))).sort();
  const visibleBanners = cityFilter
    ? banners.filter((b) => b.cities.length === 0 || b.cities.includes(cityFilter))
    : banners;

  return (
    <View style={s.wrap}>
      {banner ? <View style={s.banner}><Text style={s.bannerText}>{banner}</Text></View> : null}
      <ScrollView
        contentContainerStyle={s.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>Home Banners</Text>
            <Text style={s.sub}>{banners.length} banner{banners.length !== 1 ? 's' : ''} · shown to customers on the home screen</Text>
          </View>
          <Pressable style={s.createBtn} onPress={() => setCreating(true)}>
            <Text style={s.createBtnText}>+ Add Banner</Text>
          </Pressable>
        </View>

        {/* City-wise tabs — pick a city to see only its banners. */}
        {bannerCities.length ? (
          <View style={s.tabs}>
            <Pressable
              style={[s.tab, cityFilter === null && s.tabOn]}
              onPress={() => setCityFilter(null)}
            >
              <Text style={[s.tabText, cityFilter === null && s.tabTextOn]}>All ({banners.length})</Text>
            </Pressable>
            {bannerCities.map((city) => {
              const count = banners.filter((b) => b.cities.length === 0 || b.cities.includes(city)).length;
              return (
                <Pressable
                  key={city}
                  style={[s.tab, cityFilter === city && s.tabOn]}
                  onPress={() => setCityFilter(city)}
                >
                  <Text style={[s.tabText, cityFilter === city && s.tabTextOn]}>{city} ({count})</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {loading ? <ActivityIndicator color={theme.color.accent} style={{ margin: 32 }} /> : null}

        {visibleBanners.map((b) => (
          <View key={b.id} style={[s.card, !b.active && s.cardInactive]}>
            <Image source={{ uri: b.imageUrl }} style={s.cardImg} resizeMode="cover" />
            <View style={s.cardBody}>
              <Text style={s.cardCities} numberOfLines={2}>
                {b.cities.length ? b.cities.join(', ') : 'All cities'}
              </Text>
              <Text style={s.cardMeta}>Order {b.sortOrder}</Text>
            </View>
            <View style={s.cardActions}>
              <Switch
                value={b.active}
                onValueChange={() => handleToggle(b)}
                trackColor={{ false: theme.color.border, true: theme.color.primary }}
                thumbColor="#fff"
              />
              <Pressable style={s.delBtn} onPress={() => handleDelete(b.id)} disabled={deleting === b.id} accessibilityLabel="Delete">
                <DeleteIcon size={18} color={theme.color.critical} />
              </Pressable>
            </View>
          </View>
        ))}

        {!loading && visibleBanners.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyText}>
              {banners.length === 0
                ? 'No banners yet. Add your first promo image!'
                : `No banners for ${cityFilter}.`}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const f = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  body: { padding: theme.space.xl, gap: theme.space.md, maxWidth: 720 },
  heading: { fontSize: theme.font.h1, fontWeight: '800', color: theme.color.text, marginBottom: theme.space.md },
  label: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  input: {
    borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md,
    padding: theme.space.md, fontSize: theme.font.body, color: theme.color.text,
    backgroundColor: theme.color.surface,
  },
  preview: { width: '100%', aspectRatio: 2, borderRadius: theme.radius.lg, backgroundColor: theme.color.surface },
  previewEmpty: {
    width: '100%', aspectRatio: 2, borderRadius: theme.radius.lg, backgroundColor: theme.color.surface,
    borderWidth: 1, borderColor: theme.color.border, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
  previewEmptyText: { color: theme.color.textFaint, fontSize: theme.font.small },
  uploadBtn: {
    paddingVertical: theme.space.md, borderRadius: theme.radius.md, borderWidth: 1,
    borderColor: theme.color.primary, alignItems: 'center', backgroundColor: theme.color.surface,
  },
  uploadBtnText: { color: theme.color.primary, fontWeight: '700', fontSize: theme.font.body },
  err: { color: theme.color.critical, fontSize: theme.font.small },
  hint: { color: theme.color.textFaint, fontSize: theme.font.small },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  chip: {
    paddingVertical: theme.space.sm, paddingHorizontal: theme.space.md, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface,
  },
  chipOn: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  chipText: { fontSize: theme.font.small, color: theme.color.textMuted, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  row2: { flexDirection: 'row', gap: theme.space.lg, alignItems: 'flex-start' },
  col: { flex: 1, gap: theme.space.xs },
  activeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.space.md, marginTop: theme.space.lg },
  cancelBtn: { paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  cancelBtnText: { color: theme.color.textMuted, fontWeight: '700' },
  saveBtn: { paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl, borderRadius: theme.radius.md, backgroundColor: theme.color.primary, minWidth: 140, alignItems: 'center' },
  saveBtnDim: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: theme.font.body },
});

const s = StyleSheet.create({
  wrap: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  forbiddenText: { color: theme.color.critical, fontSize: theme.font.body },
  banner: { backgroundColor: theme.color.primary, paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl },
  bannerText: { color: '#fff', fontWeight: '600', fontSize: theme.font.small },
  body: { padding: theme.space.xl, gap: theme.space.md, maxWidth: 820 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: theme.space.md },
  h1: { fontSize: theme.font.h1, fontWeight: '800', color: theme.color.text },
  sub: { fontSize: theme.font.body, color: theme.color.textMuted, marginTop: 2 },
  createBtn: { backgroundColor: theme.color.primary, borderRadius: theme.radius.md, paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl },
  createBtnText: { color: '#fff', fontWeight: '800', fontSize: theme.font.body },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginTop: theme.space.xs },
  tab: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.md, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  tabOn: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  tabText: { fontSize: theme.font.small, color: theme.color.textMuted, fontWeight: '700' },
  tabTextOn: { color: '#fff' },
  card: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, padding: theme.space.md },
  cardInactive: { opacity: 0.55 },
  cardImg: { width: 160, height: 80, borderRadius: theme.radius.md, backgroundColor: theme.color.bg },
  cardBody: { flex: 1, gap: 3 },
  cardCities: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  cardMeta: { fontSize: theme.font.tiny, color: theme.color.textFaint },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  delBtn: { padding: theme.space.xs },
  empty: { alignItems: 'center', padding: theme.space.xxxl },
  emptyText: { color: theme.color.textMuted, fontSize: theme.font.body },
});
