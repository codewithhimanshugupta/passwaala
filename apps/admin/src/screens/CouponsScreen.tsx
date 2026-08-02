import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '@passwaala/api-client';
import { api } from '../api';
import { theme } from '../theme';

interface Coupon {
  id: string;
  code: string;
  type: string;
  value: number;
  description: string | null;
  minOrderPaise: number;
  maxUses: number | null;
  maxUsesPerUser: number | null;
  usedCount: number;
  validFrom: string | null;
  expiresAt: string | null;
  active: boolean;
  shopIds: string[];
  createdAt: string;
  _count?: { usages: number };
}

type CouponType = 'PERCENT_OFF' | 'FLAT_OFF' | 'FREE_DELIVERY';

const TYPE_LABELS: Record<CouponType, string> = {
  PERCENT_OFF: 'Percentage',
  FLAT_OFF: 'Flat Amount (₹)',
  FREE_DELIVERY: 'Free Delivery',
};

const TYPE_COLORS: Record<string, string> = {
  PERCENT_OFF: '#F97316',
  FLAT_OFF: '#10B981',
  FREE_DELIVERY: '#6366F1',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function discountLabel(c: Coupon): string {
  if (c.type === 'FREE_DELIVERY') return 'Free delivery';
  if (c.type === 'PERCENT_OFF') return `${c.value}% off`;
  return `₹${c.value / 100} off`;
}

// ---------------------------------------------------------------------------
// Create / edit form
// ---------------------------------------------------------------------------

function CouponForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<Coupon>;
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [code, setCode] = useState(initial?.code ?? '');
  const [type, setType] = useState<CouponType>((initial?.type as CouponType) ?? 'PERCENT_OFF');
  const [value, setValue] = useState(initial ? String(type === 'FLAT_OFF' ? initial.value! / 100 : initial.value ?? 0) : '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [minOrder, setMinOrder] = useState(initial ? String(initial.minOrderPaise ? initial.minOrderPaise / 100 : '') : '');
  const [maxUses, setMaxUses] = useState(initial?.maxUses != null ? String(initial.maxUses) : '');
  const [maxUsesPerUser, setMaxUsesPerUser] = useState(initial?.maxUsesPerUser != null ? String(initial.maxUsesPerUser) : '');
  const [expiresAt, setExpiresAt] = useState(initial?.expiresAt ? initial.expiresAt.slice(0, 10) : '');
  const [active, setActive] = useState(initial?.active ?? true);

  function handleSave() {
    const v = parseFloat(value) || 0;
    onSave({
      code: code.trim().toUpperCase(),
      type,
      value: type === 'FLAT_OFF' ? Math.round(v * 100) : Math.round(v),
      description: description.trim() || null,
      minOrderPaise: Math.round((parseFloat(minOrder) || 0) * 100),
      maxUses: maxUses.trim() ? parseInt(maxUses) : null,
      maxUsesPerUser: maxUsesPerUser.trim() ? parseInt(maxUsesPerUser) : null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      active,
    });
  }

  return (
    <ScrollView style={f.root} contentContainerStyle={f.body}>
      <Text style={f.heading}>{initial?.id ? 'Edit Coupon' : 'Create Discount Coupon'}</Text>

      <View style={f.row2}>
        <View style={f.col}>
          <Text style={f.label}>Coupon Code *</Text>
          <TextInput style={f.input} value={code} onChangeText={t => setCode(t.toUpperCase())}
            placeholder="SAVE20" placeholderTextColor={theme.color.textFaint} autoCapitalize="characters" />
        </View>
        <View style={f.col}>
          <Text style={f.label}>Type *</Text>
          <View style={f.typePicker}>
            {(['PERCENT_OFF', 'FLAT_OFF', 'FREE_DELIVERY'] as CouponType[]).map(t => (
              <Pressable key={t} style={[f.typeBtn, type === t && f.typeBtnActive]} onPress={() => setType(t)}>
                <Text style={[f.typeBtnText, type === t && f.typeBtnTextActive]}>
                  {t === 'PERCENT_OFF' ? '% Off' : t === 'FLAT_OFF' ? '₹ Off' : 'Free Delivery'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <Text style={f.label}>Description</Text>
      <TextInput style={[f.input, f.inputMulti]} value={description} onChangeText={setDescription}
        placeholder="Optional description shown to customers" placeholderTextColor={theme.color.textFaint} multiline />

      {type !== 'FREE_DELIVERY' ? (
        <>
          <Text style={f.label}>Discount Value * {type === 'PERCENT_OFF' ? '(%)' : '(₹)'}</Text>
          <View style={f.inputSuffix}>
            <TextInput style={[f.input, { flex: 1, borderWidth: 0 }]} value={value} onChangeText={setValue}
              keyboardType="decimal-pad" placeholder={type === 'PERCENT_OFF' ? '10' : '50'} placeholderTextColor={theme.color.textFaint} />
            <Text style={f.suffix}>{type === 'PERCENT_OFF' ? '%' : '₹'}</Text>
          </View>
        </>
      ) : null}

      <View style={f.row2}>
        <View style={f.col}>
          <Text style={f.label}>Max Uses (Optional)</Text>
          <TextInput style={f.input} value={maxUses} onChangeText={setMaxUses}
            keyboardType="number-pad" placeholder="Unlimited if empty" placeholderTextColor={theme.color.textFaint} />
        </View>
        <View style={f.col}>
          <Text style={f.label}>Max Uses Per User</Text>
          <TextInput style={f.input} value={maxUsesPerUser} onChangeText={setMaxUsesPerUser}
            keyboardType="number-pad" placeholder="Unlimited if empty" placeholderTextColor={theme.color.textFaint} />
        </View>
      </View>

      <View style={f.row2}>
        <View style={f.col}>
          <Text style={f.label}>Min Order ₹ (Optional)</Text>
          <TextInput style={f.input} value={minOrder} onChangeText={setMinOrder}
            keyboardType="decimal-pad" placeholder="0" placeholderTextColor={theme.color.textFaint} />
        </View>
        <View style={f.col}>
          <Text style={f.label}>Expires At (Optional)</Text>
          <TextInput style={f.input} value={expiresAt} onChangeText={setExpiresAt}
            placeholder="YYYY-MM-DD" placeholderTextColor={theme.color.textFaint} />
        </View>
      </View>

      <View style={f.activeRow}>
        <Text style={f.label}>Active (coupon can be used)</Text>
        <Switch value={active} onValueChange={setActive}
          trackColor={{ false: theme.color.border, true: theme.color.primary }}
          thumbColor="#fff" />
      </View>

      <View style={f.actions}>
        <Pressable style={f.cancelBtn} onPress={onCancel}>
          <Text style={f.cancelBtnText}>Cancel</Text>
        </Pressable>
        <Pressable style={[f.saveBtn, (saving || !code.trim()) && f.saveBtnDim]}
          onPress={handleSave} disabled={saving || !code.trim()}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={f.saveBtnText}>{initial?.id ? 'Save Changes' : 'Create Coupon'}</Text>}
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function CouponsScreen() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [showAll, setShowAll] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = (await api.adminListCoupons(showAll)) as Coupon[];
      setCoupons(list);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
    } finally { setLoading(false); }
  }, [showAll]);

  useEffect(() => { void load(); }, [load]);

  function flash(msg: string) { setBanner(msg); setTimeout(() => setBanner(null), 3000); }

  async function handleCreate(data: Record<string, unknown>) {
    setSaving(true);
    try {
      await api.adminCreateCoupon(data as Parameters<typeof api.adminCreateCoupon>[0]);
      flash('Coupon created!');
      setCreating(false);
      await load();
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
    finally { setSaving(false); }
  }

  async function handleUpdate(id: string, data: Record<string, unknown>) {
    setSaving(true);
    try {
      await api.adminUpdateCoupon(id, data);
      flash('Coupon updated!');
      setEditing(null);
      await load();
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
    finally { setSaving(false); }
  }

  async function handleToggle(c: Coupon) {
    try {
      await api.adminUpdateCoupon(c.id, { active: !c.active });
      await load();
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await api.adminDeleteCoupon(id);
      flash('Coupon deleted.');
      await load();
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
    finally { setDeleting(null); }
  }

  if (forbidden) return (
    <View style={s.center}>
      <Text style={s.forbiddenText}>Admin access required.</Text>
    </View>
  );

  if (creating) return (
    <CouponForm saving={saving} onCancel={() => setCreating(false)} onSave={handleCreate} />
  );

  if (editing) return (
    <CouponForm initial={editing} saving={saving}
      onCancel={() => setEditing(null)}
      onSave={(data) => handleUpdate(editing.id, data)} />
  );

  return (
    <View style={s.wrap}>
      {banner ? <View style={s.banner}><Text style={s.bannerText}>{banner}</Text></View> : null}

      <ScrollView contentContainerStyle={s.body}>
        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>Coupons</Text>
            <Text style={s.sub}>{coupons.length} coupon{coupons.length !== 1 ? 's' : ''}</Text>
          </View>
          <View style={s.headerActions}>
            <Pressable style={[s.toggleBtn, showAll && s.toggleBtnActive]} onPress={() => setShowAll(v => !v)}>
              <Text style={[s.toggleBtnText, showAll && s.toggleBtnTextActive]}>
                {showAll ? 'Showing all' : 'Active only'}
              </Text>
            </Pressable>
            <Pressable style={s.createBtn} onPress={() => setCreating(true)}>
              <Text style={s.createBtnText}>+ Create Coupon</Text>
            </Pressable>
          </View>
        </View>

        {loading ? <ActivityIndicator color={theme.color.accent} style={{ margin: 32 }} /> : null}

        {coupons.map(c => (
          <View key={c.id} style={[s.card, !c.active && s.cardInactive]}>
            <View style={s.cardHead}>
              <View style={[s.stub, { backgroundColor: TYPE_COLORS[c.type] ?? '#6B7280' }]}>
                <Text style={s.stubText}>{c.code}</Text>
              </View>
              <View style={s.cardMid}>
                <Text style={s.cardDiscount}>{discountLabel(c)}</Text>
                {c.description ? <Text style={s.cardDesc} numberOfLines={1}>{c.description}</Text> : null}
                <Text style={s.cardMeta}>
                  {c.minOrderPaise > 0 ? `Min ₹${c.minOrderPaise / 100}  ·  ` : ''}
                  Used {c._count?.usages ?? c.usedCount}×
                  {c.maxUses != null ? ` / ${c.maxUses}` : ''}
                  {c.expiresAt ? `  ·  Exp ${fmtDate(c.expiresAt)}` : ''}
                </Text>
              </View>
              <View style={s.cardActions}>
                <Switch value={c.active} onValueChange={() => handleToggle(c)}
                  trackColor={{ false: theme.color.border, true: theme.color.primary }} thumbColor="#fff" />
                <Pressable style={s.editBtn} onPress={() => setEditing(c)}>
                  <Text style={s.editBtnText}>Edit</Text>
                </Pressable>
                <Pressable style={s.delBtn} onPress={() => handleDelete(c.id)} disabled={deleting === c.id}>
                  {deleting === c.id ? <ActivityIndicator color={theme.color.critical} size="small" /> : <Text style={s.delBtnText}>✕</Text>}
                </Pressable>
              </View>
            </View>
          </View>
        ))}

        {!loading && coupons.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyText}>No coupons yet. Create your first one!</Text>
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
  body: { padding: theme.space.xl, gap: theme.space.lg, maxWidth: 720 },
  heading: { fontSize: theme.font.h1, fontWeight: '800', color: theme.color.text, marginBottom: theme.space.lg },
  row2: { flexDirection: 'row', gap: theme.space.lg },
  col: { flex: 1, gap: theme.space.xs },
  label: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  input: {
    borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md,
    padding: theme.space.md, fontSize: theme.font.body, color: theme.color.text,
    backgroundColor: theme.color.surface,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  inputSuffix: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface, paddingRight: theme.space.md,
  },
  suffix: { fontSize: theme.font.body, color: theme.color.textMuted, fontWeight: '700' },
  typePicker: { flexDirection: 'row', gap: theme.space.xs },
  typeBtn: { flex: 1, paddingVertical: theme.space.sm, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center' },
  typeBtnActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  typeBtnText: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textMuted },
  typeBtnTextActive: { color: '#fff' },
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
  headerActions: { flexDirection: 'row', gap: theme.space.sm, alignItems: 'center' },
  toggleBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.md, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  toggleBtnActive: { borderColor: theme.color.accent },
  toggleBtnText: { fontSize: theme.font.small, color: theme.color.textMuted, fontWeight: '600' },
  toggleBtnTextActive: { color: theme.color.accent },
  createBtn: { backgroundColor: theme.color.primary, borderRadius: theme.radius.md, paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl },
  createBtnText: { color: '#fff', fontWeight: '800', fontSize: theme.font.body },
  card: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, overflow: 'hidden' },
  cardInactive: { opacity: 0.55 },
  cardHead: { flexDirection: 'row', alignItems: 'center' },
  stub: { width: 64, paddingVertical: theme.space.lg, alignItems: 'center', justifyContent: 'center' },
  stubText: { color: '#fff', fontWeight: '900', fontSize: 11, textAlign: 'center' },
  cardMid: { flex: 1, padding: theme.space.md, gap: 3 },
  cardDiscount: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  cardDesc: { fontSize: theme.font.small, color: theme.color.textMuted },
  cardMeta: { fontSize: theme.font.tiny, color: theme.color.textFaint, marginTop: 2 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, paddingRight: theme.space.md },
  editBtn: { paddingVertical: theme.space.xs, paddingHorizontal: theme.space.md, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  editBtnText: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  delBtn: { padding: theme.space.xs },
  delBtnText: { fontSize: theme.font.body, color: theme.color.critical, fontWeight: '700' },
  empty: { alignItems: 'center', padding: theme.space.xxxl },
  emptyText: { color: theme.color.textMuted, fontSize: theme.font.body },
});
