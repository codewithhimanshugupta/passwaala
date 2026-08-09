import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PaymentMethod } from '@passwaala/shared';
import { api } from '../api';
import { resetBulkCartStore, useBulkCart, bulkCartSetQty, bulkCartRemoveShop } from '../bulkCart';
import { prefetchShop } from './StorefrontScreen';
import type { Address } from '../types';
import { AddressForm } from '../components/AddressForm';
import { formatRupees, shadow, theme, haversineMeters } from '../theme';
import { Button, Divider, EmptyState, Loading } from '../ui';
import { getPrefetchedCheckout, clearCheckoutPrefetch } from '../checkoutPrefetch';
import { StripedProgressBar } from '../StripedProgressBar';
import { useLang } from '../i18n/LanguageContext';
import { MULTI_SHOP_SURCHARGE_PAISE, platformDeliveryFeePaise, computeGst, PLATFORM_FEE_PAISE } from '@passwaala/shared';

interface NearbyShop {
  id: string;
  name: string;
  city: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
}

export function BulkCartScreen({
  onBack,
  onPlaced,
  onOpenShop,
  onSingleShop,
}: {
  onBack: () => void;
  onPlaced: (result: { bulkOrderId: string; shortId: string; totalPaise: number }) => void;
  onOpenShop: (shopId: string) => void;
  onSingleShop: () => void;
}) {
  const { t } = useLang();
  const bulkCart = useBulkCart();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>(PaymentMethod.UPI_DIRECT);
  const [loadingAddrs, setLoadingAddrs] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddrForm, setShowAddrForm] = useState(false);
  const [showAddrPicker, setShowAddrPicker] = useState(false);
  // Collapsed by default — tap shop header to expand
  const [expandedShops, setExpandedShops] = useState<Set<string>>(new Set());
  const [nearbyShops, setNearbyShops] = useState<NearbyShop[]>([]);
  const [nearbyHasMore, setNearbyHasMore] = useState(false);
  const [nearbyOffset, setNearbyOffset] = useState(0);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [addingShop, setAddingShop] = useState<string | null>(null);

  // Lock anchor to the FIRST shop added — don't shift when more shops are added
  const anchorShopId = bulkCart[0]?.shopId ?? null;
  const anchorRef = useRef<string | null>(null);
  if (anchorShopId && !anchorRef.current) anchorRef.current = anchorShopId;
  const lockedAnchor = anchorRef.current;

  const loadAddresses = useCallback(async () => {
    const pre = getPrefetchedCheckout();
    if (pre) {
      setAddresses(pre.addresses);
      setLoadingAddrs(false);
      if (pre.addresses.length === 0) setShowAddrForm(true);
      return;
    }
    setLoadingAddrs(true);
    try {
      const list = (await api.addresses()) as Address[];
      setAddresses(list);
      if (list.length === 0) setShowAddrForm(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingAddrs(false);
    }
  }, []);

  useEffect(() => { void loadAddresses(); }, [loadAddresses]);

  // Load nearby shops (add-on options) whenever the anchor shop changes
  useEffect(() => {
    if (!lockedAnchor) return;
    setNearbyShops([]);
    setNearbyOffset(0);
    setNearbyHasMore(false);
    void api.nearbyShopsForBulk(lockedAnchor, 0)
      .then((res) => {
        const fresh = res.items.filter((s) => !bulkCart.some((c) => c.shopId === s.id));
        setNearbyShops(fresh);
        setNearbyHasMore(res.hasMore);
        setNearbyOffset(res.items.length);
        // Prefetch products for all nearby shops in parallel (cache-aware — skips already cached)
        res.items.forEach(s => prefetchShop(s.id));
      })
      .catch(() => undefined);
  }, [lockedAnchor]);

  async function loadMoreNearby() {
    if (!lockedAnchor || !nearbyHasMore || nearbyLoading) return;
    setNearbyLoading(true);
    try {
      const res = await api.nearbyShopsForBulk(lockedAnchor, nearbyOffset);
      const fresh = res.items.filter((s) => !bulkCart.some((c) => c.shopId === s.id) && !nearbyShops.some((n) => n.id === s.id));
      setNearbyShops((prev) => [...prev, ...fresh]);
      setNearbyHasMore(res.hasMore);
      setNearbyOffset((prev) => prev + res.items.length);
      // Prefetch new shops' products (skips cached)
      res.items.forEach(s => prefetchShop(s.id));
    } catch {
      // ignore
    } finally {
      setNearbyLoading(false);
    }
  }

  // Auto-select first address
  useEffect(() => {
    if (addresses.length > 0 && !selectedAddress) {
      setSelectedAddress(addresses[0].id);
    }
  }, [addresses]);

  if (bulkCart.length === 0) {
    return (
      <View style={styles.root}>
        <Header onBack={onBack} title="Multi-shop order" />
        <EmptyState title="No shops added" subtitle="Go back and add items from multiple shops." />
      </View>
    );
  }

  // Bill calculation
  const shopCount = bulkCart.length;
  const subtotalPaise = bulkCart.reduce((sum, s) => sum + s.lines.reduce((a, l) => a + l.unitPricePaise * l.qty, 0), 0);
  const platformFeePaise = (() => { const g = computeGst(PLATFORM_FEE_PAISE); return g.totalPaise; })();
  // Base delivery: use first shop coords → selected address
  const addr = addresses.find((a) => a.id === selectedAddress);
  const anchorShop = nearbyShops.find((s) => s.id === anchorShopId) ??
    { latitude: 0, longitude: 0 };
  const dropCoords = addr ? { lat: Number(addr.latitude), lng: Number(addr.longitude) } : null;
  const anchorCoords = anchorShopId
    ? bulkCart[0] ? { lat: 0, lng: 0 } : null
    : null;
  const baseDeliveryFeePaise = dropCoords ? platformDeliveryFeePaise(3000) : 0; // indicative until coords available
  const surchargeEach = MULTI_SHOP_SURCHARGE_PAISE;
  const multiShopSurchargePaise = (shopCount - 1) * surchargeEach;
  const totalPaise = subtotalPaise + baseDeliveryFeePaise + multiShopSurchargePaise + platformFeePaise;

  const [placingCancelHandle, setPlacingCancelHandle] = useState<{ cancel: () => void } | null>(null);

  async function place() {
    if (!selectedAddress) { setError('Please select a delivery address'); return; }
    if (bulkCart.length < 2) { onSingleShop(); return; }
    let wasCancelled = false;
    setPlacing(true);
    setError(null);
    setPlacingCancelHandle({ cancel: () => { wasCancelled = true; setPlacing(false); } });
    try {
      const idempotencyKey = `pw-bulk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const result = await api.placeBulkOrder({
        shops: bulkCart.map((s) => ({
          shopId: s.shopId,
          items: s.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
        })),
        addressId: selectedAddress,
        paymentMethod: payment,
        idempotencyKey,
      });
      if (wasCancelled) {
        void api.requestCancelOrder(result.bulkOrderId, 'Customer cancelled during placement').catch(() => undefined);
        return;
      }
      resetBulkCartStore();
      onPlaced({ bulkOrderId: result.bulkOrderId, shortId: result.shortId, totalPaise: result.totalPaise });
    } catch (e) {
      if (!wasCancelled) setError((e as Error).message);
    } finally {
      if (!wasCancelled) setPlacing(false);
      setPlacingCancelHandle(null);
    }
  }

  const nearbyNotAdded = nearbyShops.filter((s) => !bulkCart.some((c) => c.shopId === s.id));

  return (
    <View style={styles.root}>
      <Header onBack={onBack} title="Multi-shop order" subtitle={`${shopCount} shops`} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Per-shop collapsible sections */}
        {bulkCart.map((shopCart) => {
          const isExpanded = expandedShops.has(shopCart.shopId);
          const shopTotal = shopCart.lines.reduce((s, l) => s + l.unitPricePaise * l.qty, 0);
          const itemCount = shopCart.lines.reduce((s, l) => s + l.qty, 0);
          return (
            <View key={shopCart.shopId} style={styles.section}>
              <Pressable
                style={styles.sectionHead}
                onPress={() => setExpandedShops(prev => {
                  const next = new Set(prev);
                  if (next.has(shopCart.shopId)) next.delete(shopCart.shopId);
                  else next.add(shopCart.shopId);
                  return next;
                })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.shopName}>{shopCart.shopName}</Text>
                  <Text style={{ fontSize: theme.font.tiny, color: theme.color.textMuted, marginTop: 1 }}>
                    {itemCount} item{itemCount !== 1 ? 's' : ''} · {formatRupees(shopTotal)}
                  </Text>
                </View>
                <Text style={{ fontSize: 18, color: theme.color.textMuted, marginRight: theme.space.sm }}>
                  {isExpanded ? '▲' : '▼'}
                </Text>
                <Pressable onPress={() => bulkCartRemoveShop(shopCart.shopId)} hitSlop={8}>
                  <Text style={styles.removeShop}>Remove</Text>
                </Pressable>
              </Pressable>
              {isExpanded ? shopCart.lines.map((line) => (
                <View key={line.productId} style={styles.itemRow}>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemName} numberOfLines={2}>{line.name}</Text>
                    <Text style={styles.itemPrice}>{formatRupees(line.unitPricePaise)}</Text>
                  </View>
                  <View style={styles.stepper}>
                    <Pressable style={styles.stepBtn} onPress={() => bulkCartSetQty(shopCart.shopId, line.productId, line.qty - 1)}>
                      <Text style={styles.stepText}>−</Text>
                    </Pressable>
                    <Text style={styles.qty}>{line.qty}</Text>
                    <Pressable style={styles.stepBtn} onPress={() => bulkCartSetQty(shopCart.shopId, line.productId, line.qty + 1)}>
                      <Text style={styles.stepText}>+</Text>
                    </Pressable>
                  </View>
                </View>
              )) : null}
            </View>
          );
        })}

        {/* Nearby shops to add */}
        {(nearbyNotAdded.length > 0 || nearbyHasMore) && shopCount < 3 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Add from nearby shops</Text>
            <Text style={styles.nearbyHint}>These shops are nearby — add items for a single delivery run</Text>
            {nearbyNotAdded.map((s) => (
              <View key={s.id} style={styles.nearbyRow}>
                <View style={styles.flex}>
                  <Text style={styles.nearbyName}>{s.name}</Text>
                  <Text style={styles.nearbyDist}>{Math.round(s.distanceMeters)} m away</Text>
                </View>
                <Pressable
                  style={[styles.addShopBtn, addingShop === s.id && styles.addShopBtnBusy]}
                  disabled={addingShop !== null}
                  onPress={() => { setAddingShop(s.id); onOpenShop(s.id); }}
                >
                  <Text style={styles.addShopText}>Browse</Text>
                </Pressable>
              </View>
            ))}
            {nearbyHasMore ? (
              <Pressable style={styles.loadMoreNearby} onPress={loadMoreNearby} disabled={nearbyLoading}>
                {nearbyLoading
                  ? <ActivityIndicator color={theme.color.primary} size="small" />
                  : <Text style={styles.loadMoreNearbyText}>Show more shops</Text>}
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Bill breakdown */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bill details</Text>
          <BillRow label="Item subtotal" value={formatRupees(subtotalPaise)} />
          <BillRow label={`Base delivery`} value={formatRupees(baseDeliveryFeePaise)} />
          {multiShopSurchargePaise > 0 ? (
            <BillRow
              label={`Multi-shop surcharge (${shopCount - 1} extra stop${shopCount > 2 ? 's' : ''})`}
              value={`+${formatRupees(multiShopSurchargePaise)}`}
            />
          ) : null}
          <BillRow label="Platform fee" value={formatRupees(platformFeePaise)} />
          <Divider style={{ marginVertical: theme.space.sm }} />
          <BillRow label="Total" value={formatRupees(totalPaise)} bold />
          <Text style={styles.surchargeNote}>
            +{formatRupees(surchargeEach)} per extra stop covers the rider's additional pickup
          </Text>
        </View>

        {/* Delivery address */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Delivery address</Text>
            <Pressable onPress={() => setShowAddrForm(true)}>
              <Text style={styles.link}>+ Add new</Text>
            </Pressable>
          </View>
          {loadingAddrs ? <Loading /> : (() => {
            const a = addresses.find((x) => x.id === selectedAddress);
            if (!a) return <Text style={styles.hint}>Select an address below</Text>;
            return (
              <View style={styles.addrCard}>
                <View style={styles.flex}>
                  <Text style={styles.addrLabel}>{a.label}</Text>
                  <Text style={styles.addrLine}>{a.line}</Text>
                  {a.landmark ? <Text style={styles.addrLandmark}>Near {a.landmark}</Text> : null}
                </View>
                {addresses.length > 1 ? (
                  <Pressable onPress={() => setShowAddrPicker(true)}>
                    <Text style={styles.link}>Change</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })()}
        </View>

        {/* Payment */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment</Text>
          <Pressable
            style={[styles.payOption, payment === PaymentMethod.UPI_DIRECT && styles.payActive]}
            onPress={() => setPayment(PaymentMethod.UPI_DIRECT)}
          >
            <Text style={styles.payTitle}>UPI</Text>
            <Text style={styles.paySub}>Pay each shop directly via UPI</Text>
          </Pressable>
          <Pressable
            style={[styles.payOption, payment === PaymentMethod.COD && styles.payActive]}
            onPress={() => setPayment(PaymentMethod.COD)}
          >
            <Text style={styles.payTitle}>Cash on delivery</Text>
            <Text style={styles.paySub}>Pay at delivery</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      {/* Place bar */}
      <View style={styles.placeBar}>
        <View>
          <Text style={styles.placeTotalLabel}>Total</Text>
          <Text style={styles.placeTotal}>{formatRupees(totalPaise)}</Text>
        </View>
        <View style={styles.flex}>
          {shopCount < 2 ? (
            <Button
              label="Switch to single-shop cart"
              onPress={onSingleShop}
              size="lg"
            />
          ) : (
            <Button
              label={placing ? 'Placing…' : 'Place bulk order'}
              onPress={place}
              busy={placing}
              disabled={!selectedAddress}
              size="lg"
            />
          )}
        </View>
      </View>

      <Modal visible={placing} transparent animationType="fade" onRequestClose={() => placingCancelHandle?.cancel()}>
        <View style={styles.overlay}>
          <View style={styles.placingCard}>
            <Text style={styles.placingText}>Placing your order…</Text>
            <StripedProgressBar color={theme.color.primary} />
            <Pressable onPress={() => placingCancelHandle?.cancel()} style={styles.placingCancelBtn}>
              <Text style={styles.placingCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Address picker */}
      <Modal visible={showAddrPicker} transparent animationType="slide" onRequestClose={() => setShowAddrPicker(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Choose address</Text>
              <Pressable onPress={() => setShowAddrPicker(false)}>
                <Text style={styles.sheetClose}>✕</Text>
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {addresses.map((a) => (
                <Pressable
                  key={a.id}
                  style={[styles.addrCard, a.id === selectedAddress && styles.addrActive]}
                  onPress={() => { setSelectedAddress(a.id); setShowAddrPicker(false); }}
                >
                  <Text style={styles.addrLabel}>{a.label}</Text>
                  <Text style={styles.addrLine}>{a.line}</Text>
                </Pressable>
              ))}
              <Button label="+ Add new address" variant="outline" onPress={() => { setShowAddrPicker(false); setShowAddrForm(true); }} style={{ marginTop: theme.space.md }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Add address */}
      <Modal visible={showAddrForm} transparent animationType="slide" onRequestClose={() => setShowAddrForm(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Add address</Text>
              <Pressable onPress={() => setShowAddrForm(false)}><Text style={styles.sheetClose}>✕</Text></Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <AddressForm
                shopGeo={null}
                platformDelivery={true}
                onSaved={async (id) => { setShowAddrForm(false); clearCheckoutPrefetch(); await loadAddresses(); setSelectedAddress(id); }}
                onError={setError}
                onCancel={() => setShowAddrForm(false)}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Header({ onBack, title, subtitle }: { onBack: () => void; title: string; subtitle?: string }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerBack}>
        <Text style={styles.headerBackText}>←</Text>
      </Pressable>
      <View>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSub}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function BillRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.billRow}>
      <Text style={[styles.billLabel, bold && styles.billBold]}>{label}</Text>
      <Text style={[styles.billValue, bold && styles.billBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  flex: { flex: 1 },
  scroll: { paddingBottom: 120, gap: theme.space.md, paddingTop: theme.space.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md, backgroundColor: theme.color.bg, ...shadow.sm },
  headerBack: { width: 36, height: 36, borderRadius: theme.radius.pill, backgroundColor: theme.color.surface, alignItems: 'center', justifyContent: 'center' },
  headerBackText: { fontSize: 20, fontWeight: '700', color: theme.color.text },
  headerTitle: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text },
  headerSub: { fontSize: theme.font.small, color: theme.color.textMuted },
  section: { backgroundColor: theme.color.card, marginHorizontal: theme.space.lg, borderRadius: theme.radius.lg, padding: theme.space.lg, gap: theme.space.sm, ...shadow.sm },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text, marginBottom: 2 },
  shopName: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  removeShop: { color: theme.color.danger, fontWeight: '600', fontSize: theme.font.small },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingVertical: 4 },
  itemInfo: { flex: 1, gap: 2 },
  itemName: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text },
  itemPrice: { fontSize: theme.font.small, color: theme.color.textMuted },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.color.primary, borderRadius: theme.radius.md },
  stepBtn: { paddingHorizontal: theme.space.md, paddingVertical: 6 },
  stepText: { color: theme.color.onPrimary, fontSize: theme.font.h3, fontWeight: '700' },
  qty: { color: theme.color.onPrimary, fontWeight: '700', minWidth: 20, textAlign: 'center' },
  nearbyHint: { fontSize: theme.font.small, color: theme.color.textMuted, marginBottom: theme.space.sm },
  nearbyRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingVertical: theme.space.sm, borderTopWidth: 1, borderTopColor: theme.color.border },
  nearbyName: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  nearbyDist: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  addShopBtn: { backgroundColor: theme.color.primary, borderRadius: theme.radius.md, paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm },
  addShopBtnBusy: { opacity: 0.5 },
  addShopText: { color: theme.color.onPrimary, fontWeight: '700', fontSize: theme.font.small },
  loadMoreNearby: { alignSelf: 'center', paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.primary, marginTop: theme.space.xs },
  loadMoreNearbyText: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.primary },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  billLabel: { fontSize: theme.font.body, color: theme.color.textMuted },
  billValue: { fontSize: theme.font.body, color: theme.color.text },
  billBold: { fontWeight: '800', color: theme.color.text, fontSize: theme.font.h3 },
  surchargeNote: { fontSize: theme.font.tiny, color: theme.color.textMuted, marginTop: 4 },
  hint: { fontSize: theme.font.small, color: theme.color.textMuted },
  addrCard: { padding: theme.space.md, borderRadius: theme.radius.md, borderWidth: 1.5, borderColor: theme.color.border, marginTop: theme.space.sm, flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm },
  addrActive: { borderColor: theme.color.primary, backgroundColor: theme.color.primaryLight },
  addrLabel: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  addrLine: { fontSize: theme.font.body, color: theme.color.text },
  addrLandmark: { fontSize: theme.font.small, color: theme.color.textMuted },
  link: { color: theme.color.primary, fontWeight: '600', fontSize: theme.font.small },
  payOption: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, padding: theme.space.md, borderRadius: theme.radius.md, borderWidth: 1.5, borderColor: theme.color.border, marginTop: theme.space.sm },
  payActive: { borderColor: theme.color.primary, backgroundColor: theme.color.primaryLight },
  payTitle: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text, flex: 1 },
  paySub: { fontSize: theme.font.small, color: theme.color.textMuted, flex: 2 },
  error: { color: theme.color.danger, textAlign: 'center', marginHorizontal: theme.space.lg, fontWeight: '600' },
  placeBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: theme.space.lg, paddingHorizontal: theme.space.lg, paddingTop: theme.space.md, paddingBottom: theme.space.lg, backgroundColor: theme.color.bg, borderTopWidth: 1, borderTopColor: theme.color.border, ...shadow.lg },
  placeTotalLabel: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  placeTotal: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text },
  overlay: { flex: 1, backgroundColor: theme.color.overlay, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },
  placingCard: { width: '100%', maxWidth: 340, backgroundColor: theme.color.bg, borderRadius: theme.radius.lg, padding: theme.space.xl, gap: theme.space.lg, ...shadow.lg },
  placingText: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text, textAlign: 'center' },
  placingCancelBtn: { alignSelf: 'center', paddingVertical: theme.space.sm, paddingHorizontal: theme.space.xl },
  placingCancelText: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  sheetBackdrop: { flex: 1, backgroundColor: theme.color.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.color.bg, borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl, paddingHorizontal: theme.space.lg, paddingTop: theme.space.lg, paddingBottom: theme.space.xl, maxHeight: '85%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.space.sm },
  sheetTitle: { fontSize: theme.font.h2, fontWeight: '700', color: theme.color.text },
  sheetClose: { fontSize: theme.font.h2, color: theme.color.textMuted, fontWeight: '700' },
});
