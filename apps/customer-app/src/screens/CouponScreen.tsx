import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from 'react-native';
import { formatRupees, shadow, theme } from '../theme';
import { api } from '../api';

interface Offer {
  id: string;
  title: string;
  type: string;
  value: number;
  minOrderPaise: number;
}

interface ShopCoupon {
  id: string;
  code: string;
  type: string;
  value: number;
  description: string | null;
  minOrderPaise: number;
  maxDiscountPaise?: number | null;
  expiresAt: string | null;
  fundedBy?: string; // 'SHOP' | 'NEARBAZ'
}

/**
 * A coupon the customer has applied at checkout. Passed up to the cart so it can
 * preview the discount (with the SAME bill maths) and send couponCode on placement.
 * A coupon is mutually exclusive with an offer and with any second coupon.
 */
export interface AppliedCoupon {
  code: string;
  type: string;
  value: number;
  minOrderPaise: number;
  maxDiscountPaise: number | null;
  fundedBy: string; // 'SHOP' | 'NEARBAZ'
}

const TYPE_COLOR: Record<string, string> = {
  PERCENT_OFF: '#F97316',
  FLAT_OFF: '#10B981',
  FREE_DELIVERY: '#6366F1',
};

function stubLabel(type: string, value: number): string {
  if (type === 'FREE_DELIVERY') return 'FREE\nDELIV';
  if (type === 'PERCENT_OFF') return `${value}%\nOFF`;
  return `₹${value / 100}\nOFF`;
}

function computeSavings(type: string, value: number, minOrderPaise: number, subtotalPaise: number): string | null {
  if (subtotalPaise > 0 && minOrderPaise > 0 && subtotalPaise < minOrderPaise) {
    return `Add ${formatRupees(minOrderPaise - subtotalPaise)} more to unlock`;
  }
  if (type === 'FREE_DELIVERY') return 'Free delivery on this order!';
  if (type === 'PERCENT_OFF') {
    const saving = Math.round((subtotalPaise * value) / 100);
    return saving > 0 ? `Save ${formatRupees(saving)} on this order!` : `${value}% off`;
  }
  if (type === 'FLAT_OFF') return `Save ${formatRupees(value)} on this order!`;
  return null;
}

function fmtExpiry(iso: string | null): string | null {
  if (!iso) return null;
  return `Expires ${new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

function CouponCard({
  code,
  type,
  value,
  description,
  minOrderPaise,
  expiresAt,
  selected,
  subtotalPaise,
  onApply,
  onRemove,
}: {
  code: string; type: string; value: number; description?: string | null;
  minOrderPaise: number; expiresAt?: string | null;
  selected: boolean; subtotalPaise: number;
  onApply: () => void; onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = TYPE_COLOR[type] ?? '#F97316';
  const savings = computeSavings(type, value, minOrderPaise, subtotalPaise);
  const locked = minOrderPaise > 0 && subtotalPaise > 0 && subtotalPaise < minOrderPaise;
  const expiry = fmtExpiry(expiresAt ?? null);

  return (
    <View style={[s.card, selected && s.cardSelected]}>
      <View style={s.cardRow}>
        <View style={[s.stub, { backgroundColor: color }]}>
          <Text style={s.stubText}>{stubLabel(type, value)}</Text>
        </View>
        <View style={s.cardBody}>
          <View style={s.cardTopRow}>
            <Text style={s.cardCode}>{code}</Text>
            <Pressable onPress={selected ? onRemove : (locked ? undefined : onApply)}>
              <Text style={[s.applyBtn, selected && s.applyBtnApplied, locked && s.applyBtnLocked]}>
                {selected ? 'APPLIED' : 'APPLY'}
              </Text>
            </Pressable>
          </View>
          {description ? <Text style={s.cardDesc} numberOfLines={expanded ? 0 : 2}>{description}</Text> : null}
          {savings ? <Text style={[s.savings, locked && s.savingsLocked]}>{savings}</Text> : null}
          {expiry ? <Text style={s.expiry}>{expiry}</Text> : null}
          <View style={s.divider} />
          <Pressable onPress={() => setExpanded(v => !v)}>
            <Text style={s.moreBtn}>{expanded ? '− LESS' : '+ MORE'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function CouponScreen({
  offers,
  selectedOfferId,
  selectedCouponCode,
  subtotalPaise,
  shopId,
  onApply,
  onApplyCoupon,
  onBack,
}: {
  offers: Offer[];
  selectedOfferId: string | null;
  selectedCouponCode?: string | null;
  subtotalPaise: number;
  shopId?: string;
  onApply: (id: string | null) => void;
  onApplyCoupon?: (coupon: AppliedCoupon | null) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [shopCoupons, setShopCoupons] = useState<ShopCoupon[]>([]);
  const [loadingCoupons, setLoadingCoupons] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [validating, setValidating] = useState(false);

  const loadCoupons = useCallback(async () => {
    if (!shopId) return;
    setLoadingCoupons(true);
    try {
      const list = (await api.shopCoupons(shopId)) as ShopCoupon[];
      setShopCoupons(list);
    } catch { /* ignore */ }
    finally { setLoadingCoupons(false); }
  }, [shopId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadCoupons(); } finally { setRefreshing(false); }
  }, [loadCoupons]);

  useEffect(() => { void loadCoupons(); }, [loadCoupons]);

  // Applying a coupon selects EXACTLY ONE discount source. The cart clears any
  // selected offer when a coupon is applied (mutual exclusivity, also enforced
  // server-side). Snapshots the fields the cart needs to preview the discount.
  function applyCoupon(c: ShopCoupon) {
    setCodeError(null);
    onApplyCoupon?.({
      code: c.code,
      type: c.type,
      value: c.value,
      minOrderPaise: c.minOrderPaise,
      maxDiscountPaise: c.maxDiscountPaise ?? null,
      fundedBy: c.fundedBy ?? 'SHOP',
    });
    onBack();
  }

  async function handleApplyCode() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    // Check against offer titles first (offers are code-less; matched by title).
    const matchOffer = offers.find(o => o.title.toUpperCase() === trimmed);
    if (matchOffer) {
      setCodeError(null);
      onApply(matchOffer.id);
      onBack();
      return;
    }
    // Then against the shop's listed coupons (incl. NearBaz city coupons).
    const matchCoupon = shopCoupons.find(c => c.code === trimmed);
    if (matchCoupon) {
      applyCoupon(matchCoupon);
      return;
    }
    // Fall back to a server validate so ANY valid code (even one not surfaced in
    // the list) is accepted — the server enforces city/shop scope + limits.
    if (!shopId) { setCodeError('Invalid coupon code. Check the code and try again.'); return; }
    setValidating(true);
    try {
      const c = (await api.validateCoupon(trimmed, shopId, subtotalPaise)) as ShopCoupon;
      applyCoupon(c);
    } catch (e) {
      setCodeError((e as Error).message || 'Invalid coupon code. Check the code and try again.');
    } finally {
      setValidating(false);
    }
  }

  const seenIds = new Set<string>();
  const allItems = [
    ...offers.map(o => ({ kind: 'offer' as const, id: o.id, code: o.title, type: o.type, value: o.value, description: null as string | null, minOrderPaise: o.minOrderPaise, maxDiscountPaise: null as number | null, expiresAt: null as string | null, fundedBy: 'SHOP' })),
    ...shopCoupons.map(c => ({ kind: 'coupon' as const, id: c.id, code: c.code, type: c.type, value: c.value, description: c.description, minOrderPaise: c.minOrderPaise, maxDiscountPaise: c.maxDiscountPaise ?? null, expiresAt: c.expiresAt, fundedBy: c.fundedBy ?? 'SHOP' })),
  ].filter(item => { if (seenIds.has(item.id)) return false; seenIds.add(item.id); return true; });

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={onBack} style={s.backBtn} hitSlop={12}>
          <Text style={s.backArrow}>←</Text>
        </Pressable>
        <View>
          <Text style={s.headerTitle}>APPLY COUPON</Text>
          <Text style={s.headerSub}>Your Cart: {formatRupees(subtotalPaise)}</Text>
        </View>
      </View>

      <View style={s.codeBox}>
        <TextInput
          style={s.codeInput}
          placeholder="Enter Coupon Code"
          placeholderTextColor={theme.color.textFaint}
          autoCapitalize="characters"
          value={code}
          onChangeText={t => { setCode(t.toUpperCase()); setCodeError(null); }}
          returnKeyType="done"
          onSubmitEditing={handleApplyCode}
        />
        <Pressable onPress={handleApplyCode} disabled={!code.trim() || validating}>
          <Text style={[s.codeApply, (!code.trim() || validating) && s.codeApplyDim]}>{validating ? '…' : 'APPLY'}</Text>
        </Pressable>
      </View>
      {codeError ? <Text style={s.codeError}>{codeError}</Text> : null}

      <FlatList
        data={allItems}
        keyExtractor={item => item.id}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          loadingCoupons ? (
            <ActivityIndicator color={theme.color.primary} style={{ margin: 16 }} />
          ) : allItems.length > 0 ? (
            <Text style={s.sectionLabel}>AVAILABLE COUPONS</Text>
          ) : null
        }
        ListEmptyComponent={
          !loadingCoupons ? <Text style={s.empty}>No offers available for this shop right now.</Text> : null
        }
        renderItem={({ item }) => (
          <CouponCard
            code={item.code}
            type={item.type}
            value={item.value}
            description={item.description}
            minOrderPaise={item.minOrderPaise}
            expiresAt={item.expiresAt}
            selected={item.kind === 'offer' ? selectedOfferId === item.id : (selectedCouponCode ?? null) === item.code}
            subtotalPaise={subtotalPaise}
            onApply={() => {
              if (item.kind === 'offer') { onApply(item.id); onBack(); }
              else {
                applyCoupon({
                  id: item.id, code: item.code, type: item.type, value: item.value,
                  description: item.description, minOrderPaise: item.minOrderPaise,
                  maxDiscountPaise: item.maxDiscountPaise, expiresAt: item.expiresAt, fundedBy: item.fundedBy,
                });
              }
            }}
            onRemove={() => {
              if (item.kind === 'offer') onApply(null);
              else { onApplyCoupon?.(null); }
            }}
          />
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F5F5' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', ...shadow.sm },
  backBtn: { padding: 4 },
  backArrow: { fontSize: 22, color: '#111827', fontWeight: '700' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#111827', letterSpacing: 0.5 },
  headerSub: { fontSize: 12, color: '#6B7280', marginTop: 1 },
  codeBox: { flexDirection: 'row', alignItems: 'center', margin: 16, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', paddingHorizontal: 14, paddingVertical: 2, ...shadow.sm },
  codeInput: { flex: 1, fontSize: 15, color: '#111827', paddingVertical: 12 },
  codeApply: { fontSize: 14, fontWeight: '800', color: theme.color.primary, paddingLeft: 12 },
  codeApplyDim: { opacity: 0.35 },
  codeError: { marginHorizontal: 16, marginTop: -8, fontSize: 12, color: '#DC2626', marginBottom: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#6B7280', letterSpacing: 1, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  list: { paddingBottom: 32 },
  empty: { textAlign: 'center', color: '#9CA3AF', fontSize: 14, padding: 32 },
  card: { backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 12, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#E5E7EB', ...shadow.sm },
  cardSelected: { borderColor: theme.color.primary, borderWidth: 1.5 },
  cardRow: { flexDirection: 'row' },
  stub: { width: 52, justifyContent: 'center', alignItems: 'center', paddingVertical: 16 },
  stubText: { color: '#fff', fontWeight: '900', fontSize: 11, textAlign: 'center', lineHeight: 16, transform: [{ rotate: '-90deg' }], width: 76 },
  cardBody: { flex: 1, padding: 14, gap: 4 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardCode: { flex: 1, fontSize: 15, fontWeight: '800', color: '#111827', marginRight: 8, letterSpacing: 0.5 },
  cardDesc: { fontSize: 12, color: '#6B7280' },
  applyBtn: { fontSize: 13, fontWeight: '800', color: theme.color.primary },
  applyBtnApplied: { color: '#16A34A' },
  applyBtnLocked: { color: '#9CA3AF' },
  savings: { fontSize: 13, color: '#16A34A', fontWeight: '600' },
  savingsLocked: { color: '#D97706' },
  expiry: { fontSize: 11, color: '#9CA3AF' },
  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 6 },
  moreBtn: { fontSize: 12, fontWeight: '700', color: theme.color.primary, marginTop: 2 },
});
