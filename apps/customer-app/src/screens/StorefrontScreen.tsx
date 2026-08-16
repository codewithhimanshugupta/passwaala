import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ProductPublic, ProductDetailPublic } from '@passwaala/shared';
import { MEDICAL_CATEGORY } from '@passwaala/shared';
import { api } from '../api';
import {
  addOne,
  clearCart,
  decOne,
  isDifferentShopError,
  useCart,
} from '../cart';
import type { Review, ShopView } from '../types';
import {
  bannerImage,
  formatDistance,
  formatRupees,
  logoImage,
  productImage,
  shadow,
  theme,
} from '../theme';
import { Badge, Button, ErrorState, Loading, StorefrontSkeleton, Stars } from '../ui';
import { ImageOrInitial } from '../ImageOrInitial';
import { prefetchCheckout } from '../checkoutPrefetch';
import { bulkCartAddOne, bulkCartDecOne, useBulkCart } from '../bulkCart';
import { useLang } from '../i18n/LanguageContext';
import { openMapsDirections } from '../geo';

/** Products rendered per page (client-side pagination; grows on scroll). */
const PRODUCT_PAGE = 5;

/** Module-level product + shop cache — keyed by shopId. Survives navigation. */
export const _shopProductCache = new Map<string, ProductPublic[]>();
export const _shopDataCache2 = new Map<string, ShopView>();

/** Prefetch a shop's products + config in the background. Safe to call multiple times. */
export function prefetchShop(shopId: string): void {
  if (_shopProductCache.has(shopId)) return; // already cached
  void Promise.all([
    api.shopProducts(shopId).then(p => { _shopProductCache.set(shopId, p); }).catch(() => undefined),
    api.shop(shopId).then(s => { _shopDataCache2.set(shopId, s as ShopView); }).catch(() => undefined),
  ]);
}

/**
 * StorefrontScreen — a shop's catalog (plan → Catalog & Product). Banner header,
 * product list with thumbnails + MRP strike-through, the signature inline +/-
 * ADD stepper (SERVER-AUTHORITATIVE — quantity is derived from GET /cart after
 * every mutation), out-of-stock handling, a reviews section, and a sticky bottom
 * cart bar. The 409 "different shop" conflict prompts a Clear-cart action.
 */
export function StorefrontScreen({
  shopId,
  onBack,
  onOpenCart,
  onOpenPrescription,
  fromBulk = false,
}: {
  shopId: string;
  onBack: () => void;
  onOpenCart: () => void;
  /** Navigate to the prescription upload flow (medical shops only). */
  onOpenPrescription: (shopId: string) => void;
  fromBulk?: boolean;
}) {
  const { t } = useLang();
  const bulkCart = useBulkCart();
  const bulkQtyByProduct = fromBulk
    ? Object.fromEntries((bulkCart.find(s => s.shopId === shopId)?.lines ?? []).map(l => [l.productId, l.qty]))
    : {};
  const [shop, setShop] = useState<ShopView | null>(null);
  const [products, setProducts] = useState<ProductPublic[]>([]);
  // Client-side pagination: render PRODUCT_PAGE rows at a time, grow on scroll.
  const [visibleCount, setVisibleCount] = useState(PRODUCT_PAGE);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [conflict, setConflict] = useState<{ productId: string; message: string } | null>(null);

  // Lazy product detail: tapping a product expands it and fetches its
  // description on demand (list view carries only name+price to stay light).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, ProductDetailPublic>>({});
  // Fullscreen image preview (lightbox) — holds the tapped product's image + name.
  const [preview, setPreview] = useState<{ uri: string; name: string } | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  // Search + category drill-down. `query` is the raw input; a debounced effect
  // calls searchProducts. `activeCategory` is null for "All".
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const { qtyByProduct, itemCount, totalPaise, shopId: cartShopId, shopName: cartShopName } = useCart();

  const load = useCallback(async () => {
    if (!shopId) return;
    // Use prefetched cache for instant render — no skeleton if already cached
    const cachedShop = _shopDataCache2.get(shopId);
    const cachedProducts = _shopProductCache.get(shopId);
    if (cachedShop && cachedProducts) {
      setShop(cachedShop);
      setProducts(cachedProducts);
      setLoading(false);
      // Still refresh in background silently
      void Promise.all([
        api.shop(shopId).then(s => { _shopDataCache2.set(shopId, s as ShopView); setShop(s as ShopView); }),
        api.shopProducts(shopId).then(p => { _shopProductCache.set(shopId, p); setProducts(p); }),
      ]).catch(() => undefined);
      return;
    }
    if (!shop) setLoading(true);
    setError(null);
    try {
      const [shopData, list] = await Promise.all([
        api.shop(shopId) as Promise<ShopView>,
        api.shopProducts(shopId),
      ]);
      _shopDataCache2.set(shopId, shopData);
      _shopProductCache.set(shopId, list);
      setShop(shopData);
      setProducts(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // Background (non-blocking): reviews + categories. Failures are non-fatal —
    // the storefront is already usable without them.
    void (api.shopReviews(shopId) as Promise<Review[]>)
      .then(setReviews)
      .catch(() => undefined);
    void api.shopCategories(shopId)
      .then(setCategories)
      .catch(() => undefined);
  }, [shopId]);

  // Reset pagination to the first page whenever the product list changes
  // (initial load, search, or category filter) so we start at PRODUCT_PAGE rows.
  useEffect(() => {
    setVisibleCount(PRODUCT_PAGE);
  }, [products]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  // Debounced search / category filtering. Skips the very first render (initial
  // full list is loaded by `load`); refetches whenever the query or category
  // changes. Empty query + no category → the shop's full catalog.
  const didMountFilter = useRef(false);
  useEffect(() => {
    if (!didMountFilter.current) {
      didMountFilter.current = true;
      return;
    }
    const q = query.trim();
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const list = await api.searchProducts(shopId, {
          q: q || undefined,
          categoryId: activeCategory ?? undefined,
        });
        if (!cancelled) setProducts(list);
      } catch (e) {
        if (!cancelled) setNotice((e as Error).message);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, activeCategory, shopId]);

  const runMutation = useCallback(
    async (productId: string, fn: () => Promise<unknown>) => {
      setNotice(null);
      setConflict(null);
      try {
        await fn();
      } catch (e) {
        if (isDifferentShopError(e)) {
          setConflict({ productId, message: (e as Error).message });
        } else {
          setNotice((e as Error).message);
        }
      }
    },
    [],
  );

  const onAdd = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p || !p.available || !p.inStock) {
      setNotice(t.storefront.outOfStock);
      return Promise.resolve();
    }
    if (fromBulk) {
      bulkCartAddOne(productId, {
        shopId,
        shopName: shop?.name ?? '',
        name: p.name,
        unitPricePaise: p.pricePaise,
        imageUrl: p.imageUrl ?? null,
      });
      return Promise.resolve();
    }
    void prefetchCheckout(shopId);
    return runMutation(productId, () =>
      addOne(productId, shop ? {
        shopId,
        shopName: shop.name,
        name: p.name,
        unitPricePaise: p.pricePaise,
        imageUrl: p.imageUrl,
      } : undefined),
    );
  };
  const onSub = (productId: string) => {
    if (fromBulk) {
      bulkCartDecOne(shopId, productId);
      return Promise.resolve();
    }
    return runMutation(productId, () => decOne(productId));
  };

  // Toggle a product open/closed; on first open, lazily fetch its detail.
  const onToggleDetail = useCallback(async (productId: string) => {
    setExpandedId((cur) => (cur === productId ? null : productId));
    if (detailById[productId]) return; // already loaded — just expand
    setDetailLoadingId(productId);
    try {
      const detail = await api.productDetail(productId);
      setDetailById((m) => ({ ...m, [productId]: detail }));
    } catch {
      // Non-fatal: expanding still shows the list info; detail just stays absent.
    } finally {
      setDetailLoadingId((cur) => (cur === productId ? null : cur));
    }
  }, [detailById]);

  async function onClearAndAdd() {
    if (!conflict) return;
    const productId = conflict.productId;
    const p = products.find((x) => x.id === productId);
    setConflict(null);
    await runMutation(productId, () =>
      clearCart(p && shop ? {
        productId,
        shopId,
        shopName: shop.name,
        name: p.name,
        unitPricePaise: p.pricePaise,
        imageUrl: p.imageUrl,
      } : undefined),
    );
  }

  if (loading) return <StorefrontSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const cartIsThisShop = cartShopId === shopId;
  // Medical shops (pharmacies) can't be shopped from a catalog — the customer
  // uploads a prescription instead. Replace the product list + cart bar with an
  // "Upload prescription" CTA (header + reviews are kept intact).
  const isMedical = shop?.shopCategory === MEDICAL_CATEGORY;
  // In bulk mode: show the bulk cart for this specific shop
  const bulkShopLines = fromBulk ? (bulkCart.find(s => s.shopId === shopId)?.lines ?? []) : [];
  const bulkItemCount = bulkShopLines.reduce((s, l) => s + l.qty, 0);
  const bulkTotal = bulkShopLines.reduce((s, l) => s + l.unitPricePaise * l.qty, 0);
  const showCartBar = isMedical ? false : (fromBulk ? bulkItemCount > 0 : itemCount > 0);

  return (
    <View style={styles.root}>
      <FlatList
        data={isMedical ? [] : products.slice(0, visibleCount)}
        keyExtractor={(p) => p.id}
        numColumns={1}
        key="list-1"
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.5}
        onEndReached={() => setVisibleCount((n) => (n < products.length ? n + PRODUCT_PAGE : n))}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={[styles.list, showCartBar && styles.listWithBar]}
        ListHeaderComponent={
          <StoreHeader
            shop={shop}
            onBack={onBack}
            conflict={conflict}
            notice={notice}
            onClearAndAdd={onClearAndAdd}
            onDismissConflict={() => setConflict(null)}
            query={query}
            onQueryChange={setQuery}
            categories={categories}
            activeCategory={activeCategory}
            onSelectCategory={setActiveCategory}
            searching={searching}
            isMedical={isMedical}
            onUploadPrescription={() => onOpenPrescription(shopId)}
          />
        }
        ListEmptyComponent={
          isMedical ? null : (
            <Text style={styles.empty}>
              {query.trim() || activeCategory
                ? t.storefront.noProductsMatch
                : t.storefront.noProductsYet}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <ProductRow
            product={item}
            qty={fromBulk ? (bulkQtyByProduct[item.id] ?? 0) : (qtyByProduct[item.id] ?? 0)}
            onAdd={() => onAdd(item.id)}
            onSub={() => onSub(item.id)}
            expanded={expandedId === item.id}
            detail={detailById[item.id] ?? null}
            detailLoading={detailLoadingId === item.id}
            onToggleDetail={() => onToggleDetail(item.id)}
            onPreviewImage={(uri) => setPreview({ uri, name: item.name })}
          />
        )}
        extraData={`${JSON.stringify(qtyByProduct)}|${expandedId}`}
        ListFooterComponent={<ReviewsSection reviews={reviews} />}
      />

      {showCartBar ? (
        <Pressable style={styles.cartBar} onPress={onOpenCart}>
          <View style={styles.cartBarLeft}>
            <View style={styles.cartCountPill}>
              <Text style={styles.cartCountText}>{fromBulk ? bulkItemCount : itemCount}</Text>
            </View>
            <View>
              <Text style={styles.cartBarLabel}>
                {fromBulk ? `${shop?.name ?? 'This shop'} · bulk order` : cartIsThisShop ? t.storefront.viewCart : t.storefront.cartOfShop(cartShopName ?? '')}
              </Text>
              <Text style={styles.cartBarTotal}>{formatRupees(fromBulk ? bulkTotal : totalPaise)}</Text>
            </View>
          </View>
          <Text style={styles.cartBarArrow}>{fromBulk ? 'Back to bulk order →' : t.storefront.checkout}</Text>
        </Pressable>
      ) : null}

      {/* Fullscreen image preview (lightbox). Tap the ✕ or the backdrop to close. */}
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable style={styles.previewBackdrop} onPress={() => setPreview(null)}>
          <Pressable style={styles.previewClose} onPress={() => setPreview(null)} hitSlop={10}>
            <Text style={styles.previewCloseText}>✕</Text>
          </Pressable>
          {preview ? (
            <Image source={{ uri: preview.uri }} style={styles.previewImage} resizeMode="contain" />
          ) : null}
          {preview ? <Text style={styles.previewName}>{preview.name}</Text> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function StoreHeader({
  shop,
  onBack,
  conflict,
  notice,
  onClearAndAdd,
  onDismissConflict,
  query,
  onQueryChange,
  categories,
  activeCategory,
  onSelectCategory,
  searching,
  isMedical,
  onUploadPrescription,
}: {
  shop: ShopView | null;
  onBack: () => void;
  conflict: { productId: string; message: string } | null;
  notice: string | null;
  onClearAndAdd: () => void;
  onDismissConflict: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  categories: Array<{ id: string; name: string }>;
  activeCategory: string | null;
  onSelectCategory: (id: string | null) => void;
  searching: boolean;
  isMedical: boolean;
  onUploadPrescription: () => void;
}) {
  const { t } = useLang();
  if (!shop) return null;
  const distance = formatDistance(shop.distanceMeters);
  const addressText = [shop.addressLine, shop.city].filter(Boolean).join(', ');
  const hasCoords = shop.latitude != null && shop.longitude != null;
  const canDirect = hasCoords || Boolean(addressText);
  const openDirections = () => {
    const destination = hasCoords
      ? `${shop.latitude},${shop.longitude}`
      : encodeURIComponent(addressText);
    openMapsDirections(destination);
  };
  const callShop = () => {
    if (shop.contactPhone) void Linking.openURL(`tel:${shop.contactPhone}`);
  };
  return (
    <View>
      <View style={styles.bannerWrap}>
        <ImageOrInitial
          uri={bannerImage(shop.id, shop.bannerUrl ?? shop.storefrontPhotoUrl, 480, 220, shop.name)}
          name={shop.name}
          style={styles.banner}
        />
        <View style={styles.bannerScrim} />
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </Pressable>
        <Badge
          label={shop.isOpen ? t.storefront.openNow : t.storefront.closed}
          tone={shop.isOpen ? 'success' : 'neutral'}
          style={styles.bannerBadge}
        />
      </View>

      <View style={styles.shopHead}>
        <ImageOrInitial uri={logoImage(shop.id, shop.logoUrl, 96, shop.name)} name={shop.name} rounded style={styles.shopLogo} />
        <View style={styles.flex}>
          <Text style={styles.shopName}>{shop.name}</Text>
          <View style={styles.shopMetaRow}>
            {shop.ratingCount > 0 ? (
              <>
                <Stars rating={shop.avgRating} size={theme.font.body} />
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.metaText}>{t.storefront.ratings(shop.ratingCount)}</Text>
              </>
            ) : (
              <Badge label={t.storefront.newBadge} tone="accent" />
            )}
            {distance ? (
              <>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.metaText}>{distance}</Text>
              </>
            ) : null}
          </View>
        </View>
      </View>

      {addressText || shop.contactPhone ? (
        <View style={styles.contactBlock}>
          {addressText ? (
            <Text style={styles.contactLine} numberOfLines={2}>
              {addressText}
            </Text>
          ) : null}
          {shop.contactPhone ? (
            <Pressable
              onPress={callShop}
              style={({ pressed }) => [styles.contactBtnCall, pressed && styles.contactBtnPressed]}
              hitSlop={6}
            >
              <Text style={styles.contactBtnCallText}>{t.storefront.call}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {isMedical ? (
        <View style={styles.rxCta}>
          <Text style={styles.rxCtaTitle}>{t.rx.storefrontTitle}</Text>
          <Text style={styles.rxCtaSub}>{t.rx.storefrontSubtitle}</Text>
          <Button label={t.rx.uploadCta} onPress={onUploadPrescription} />
        </View>
      ) : (
        <>
          <View style={styles.infoStrip}>
            {(shop as { activeOffer?: { title?: string } | null }).activeOffer?.title ? (
              <Badge label={(shop as { activeOffer: { title: string } }).activeOffer.title} tone="success" />
            ) : null}
          </View>

          {conflict ? (
            <View style={styles.conflictBox}>
              <Text style={styles.conflictTitle}>{t.storefront.conflictTitle}</Text>
              <Text style={styles.conflictMsg}>{conflict.message}</Text>
              <View style={styles.conflictActions}>
                <Button label={t.storefront.clearCartAdd} onPress={onClearAndAdd} variant="danger" size="sm" fullWidth={false} />
                <Button label={t.storefront.keepCurrentCart} onPress={onDismissConflict} variant="ghost" size="sm" fullWidth={false} />
              </View>
            </View>
          ) : null}

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}

          {/* Search bar */}
          <View style={styles.searchWrap}>
            <View style={[styles.searchBar, query.length > 0 && styles.searchBarActive]}>
              <TextInput
                style={styles.searchInput}
                placeholder={t.storefront.searchPlaceholder}
                placeholderTextColor={theme.color.textFaint}
                value={query}
                onChangeText={onQueryChange}
                returnKeyType="search"
                autoCorrect={false}
              />
              {searching ? (
                <ActivityIndicator size="small" color={theme.color.primary} />
              ) : query.length > 0 ? (
                <Pressable onPress={() => onQueryChange('')} hitSlop={12} style={styles.searchClearBtn}>
                  <Text style={styles.searchClearText}>✕</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* Category chips */}
          {categories.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.catRow}
            >
              <CategoryChip
                label={t.storefront.categoryAll}
                active={activeCategory === null}
                onPress={() => onSelectCategory(null)}
              />
              {categories.map((c) => (
                <CategoryChip
                  key={c.id}
                  label={c.name}
                  active={activeCategory === c.id}
                  onPress={() => onSelectCategory(c.id)}
                />
              ))}
            </ScrollView>
          ) : null}

          <Text style={styles.sectionTitle}>{t.storefront.products}</Text>
        </>
      )}
    </View>
  );
}

function CategoryChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.catChip, active && styles.catChipActive]}>
      <Text style={[styles.catChipText, active && styles.catChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ProductRow({
  product,
  qty,
  onAdd,
  onSub,
  expanded,
  detail,
  detailLoading,
  onToggleDetail,
  onPreviewImage,
}: {
  product: ProductPublic;
  qty: number;
  onAdd: () => void;
  onSub: () => void;
  expanded: boolean;
  detail: ProductDetailPublic | null;
  detailLoading: boolean;
  onToggleDetail: () => void;
  onPreviewImage: (uri: string) => void;
}) {
  const { t } = useLang();
  const hasMrp = product.mrpPaise && product.mrpPaise > product.pricePaise;
  const discount = hasMrp
    ? Math.round(((product.mrpPaise! - product.pricePaise) / product.mrpPaise!) * 100)
    : 0;
  const orderable = product.inStock && product.available;

  return (
    <View style={styles.productCard}>
      {/* Discount badge — outside image wrap so it's never clipped */}
      {discount >= 1 ? (
        <View style={styles.discountTag}>
          <Text style={styles.discountText}>{t.storefront.percentOff(discount)}</Text>
        </View>
      ) : null}

      {/* Row: [image] [name+price — tap toggles detail] [add/stepper controls].
          The controls are OUTSIDE the toggle Pressable so tapping +/- never also
          fires the detail toggle (which previously caused a double-action). */}
      <View style={styles.productTapArea}>
        {/* Image — tapping a real image opens the fullscreen preview. */}
        <Pressable
          style={styles.productImageWrap}
          onPress={() => {
            const uri = productImage(product.id, product.imageUrl, 600, product.name);
            if (product.imageUrl && uri) onPreviewImage(uri);
            else onToggleDetail();
          }}
        >
          <ImageOrInitial
            uri={productImage(product.id, product.imageUrl, 200, product.name)}
            name={product.name}
            style={styles.productImage}
          />
          {qty > 0 ? (
            <View style={styles.inCartBadge}>
              <Text style={styles.inCartText}>{qty} in cart</Text>
            </View>
          ) : null}
        </Pressable>

        {/* Name + price — tapping this text area toggles the lazy detail. */}
        <Pressable style={styles.productInfo} onPress={onToggleDetail}>
          <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
          {!expanded ? (
            <Text style={styles.productHint}>{t.storefront.tapForDetails}</Text>
          ) : null}
          <View style={styles.productPriceRow}>
            <Text style={styles.productPrice}>{formatRupees(product.pricePaise)}</Text>
            {hasMrp ? (
              <Text style={styles.productMrp}>{formatRupees(product.mrpPaise!)}</Text>
            ) : null}
          </View>
        </Pressable>

        {/* Add / stepper — independent controls (not inside the toggle area). */}
        <View style={styles.productActions}>
          {qty > 0 ? (
            // Always allow adjusting an item already in the cart — even if it
            // just went out of stock — so it can be decremented/removed. Only
            // the "+" is disabled when the product is no longer orderable.
            <View style={styles.stepper}>
              <Pressable style={styles.stepBtn} onPress={onSub}>
                <Text style={styles.stepText}>−</Text>
              </Pressable>
              <Text style={styles.qty}>{qty}</Text>
              <Pressable
                style={[styles.stepBtn, !orderable && { opacity: 0.4 }]}
                onPress={orderable ? onAdd : undefined}
                disabled={!orderable}
              >
                <Text style={styles.stepText}>+</Text>
              </Pressable>
            </View>
          ) : !orderable ? (
            <View style={styles.outOfStockBadge}>
              <Text style={styles.outOfStockText}>{t.storefront.outOfStock}</Text>
            </View>
          ) : (
            <Pressable
              style={styles.addBtn}
              onPress={onAdd}
            >
              <Text style={styles.addBtnText}>{t.storefront.add}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Lazy-loaded detail, shown only when this row is expanded. */}
      {expanded ? (
        <View style={styles.detailBlock}>
          {detailLoading && !detail ? (
            <ActivityIndicator size="small" color={theme.color.primary} />
          ) : detail?.description ? (
            <Text style={styles.detailText}>{detail.description}</Text>
          ) : (
            <Text style={styles.detailEmpty}>{t.storefront.noDetail}</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

function ReviewsSection({ reviews }: { reviews: Review[] }) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(false);
  const COMPACT_LIMIT = 5;
  const canToggle = reviews.length > COMPACT_LIMIT;
  const visible = expanded ? reviews : reviews.slice(0, COMPACT_LIMIT);
  return (
    <View style={styles.reviews}>
      <Text style={styles.sectionTitle}>{t.storefront.reviews}</Text>
      {reviews.length === 0 ? (
        <Text style={styles.noReviews}>{t.storefront.noReviews}</Text>
      ) : (
        <>
          {visible.map((r) => {
            const name = r.reviewerName?.trim() || t.storefront.defaultCustomer;
            const memberSince = formatMemberSince(r.memberSince);
            const avatarInitials = name.slice(0, 2).toUpperCase();
            return (
              <View key={r.id} style={styles.reviewCard}>
                <View style={styles.reviewHead}>
                  <View style={styles.reviewAuthor}>
                    <View style={styles.reviewAvatar}>
                      <Text style={styles.reviewAvatarText}>{avatarInitials}</Text>
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.reviewName} numberOfLines={1}>
                        {name}
                      </Text>
                      {memberSince ? (
                        <Text style={styles.reviewMemberSince}>{t.storefront.memberSince(memberSince)}</Text>
                      ) : null}
                    </View>
                  </View>
                  <Text style={styles.reviewDate}>{new Date(r.createdAt).toLocaleDateString()}</Text>
                </View>
                <Text style={styles.reviewStars}>
                  {'★'.repeat(r.rating)}
                  {'☆'.repeat(5 - r.rating)}
                </Text>
                {r.comment ? (
                  <Text style={styles.reviewComment} numberOfLines={expanded ? undefined : 3}>
                    {r.comment}
                  </Text>
                ) : null}
              </View>
            );
          })}
          {canToggle ? (
            <Pressable
              onPress={() => setExpanded((v) => !v)}
              style={({ pressed }) => [styles.reviewToggle, pressed && styles.contactBtnPressed]}
              hitSlop={6}
            >
              <Text style={styles.reviewToggleText}>
                {expanded ? t.storefront.showLess : t.storefront.seeAllReviews(reviews.length)}
              </Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

/** Pretty "Mon YYYY" (e.g. "Mar 2024") from an ISO date, or null if unparseable. */
function formatMemberSince(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  flex: { flex: 1 },
  list: { paddingBottom: theme.space.xxl, paddingHorizontal: theme.space.xs },
  listWithBar: { paddingBottom: 96 },

  bannerWrap: { position: 'relative' },
  banner: { width: '100%', height: 180, backgroundColor: theme.color.surfaceAlt },
  bannerScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.15)' },
  backBtn: {
    position: 'absolute',
    top: theme.space.md,
    left: theme.space.md,
    width: 38,
    height: 38,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.sm,
  },
  backBtnText: { fontSize: 22, fontWeight: "700", color: theme.color.text },
  bannerBadge: { position: 'absolute', top: theme.space.md, right: theme.space.md },

  shopHead: {
    flexDirection: 'row',
    gap: theme.space.md,
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.md,
    alignItems: 'center',
    backgroundColor: theme.color.bg,
  },
  shopLogo: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.md,
    marginTop: -28,
    borderWidth: 2,
    borderColor: theme.color.bg,
    backgroundColor: theme.color.surfaceAlt,
  },
  shopName: { fontSize: theme.font.h1, fontWeight: "800", color: theme.color.text },
  shopMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  metaDot: { color: theme.color.textFaint },
  metaText: { fontSize: theme.font.small, color: theme.color.textMuted },

  contactBlock: {
    backgroundColor: theme.color.bg,
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.sm,
    gap: theme.space.sm,
  },
  contactLine: { fontSize: theme.font.small, color: theme.color.textMuted },
  contactActions: { flexDirection: 'row', gap: theme.space.sm, flexWrap: 'wrap' },
  contactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: theme.space.lg,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.primary,
    minWidth: 120,
    justifyContent: 'center',
    ...shadow.sm,
  },
  contactBtnCall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: theme.space.lg,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.primary,
    ...shadow.sm,
  },
  contactBtnPressed: { opacity: 0.75 },
  contactBtnIcon: { fontSize: 15 },
  contactBtnText: {
    fontSize: theme.font.small,
    fontWeight: '700',
    color: '#fff',
  },
  contactBtnCallText: { fontSize: theme.font.small, fontWeight: '700', color: '#fff' },

  searchWrap: { backgroundColor: theme.color.bg, paddingHorizontal: theme.space.lg, paddingTop: theme.space.md, paddingBottom: theme.space.xs },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.lg,
    borderWidth: 1.5,
    borderColor: theme.color.border,
    paddingHorizontal: theme.space.md,
    paddingVertical: Platform.OS === 'ios' ? 10 : 4,
  },
  searchBarActive: {
    borderColor: theme.color.primary,
    backgroundColor: theme.color.bg,
  },
  searchIcon: { fontSize: 15, opacity: 0.5 },
  searchInput: { flex: 1, fontSize: theme.font.body, color: theme.color.text, paddingVertical: 4 },
  searchClearBtn: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: theme.color.textFaint,
    alignItems: 'center', justifyContent: 'center',
  },
  searchClearText: { fontSize: 11, color: theme.color.bg, fontWeight: '800', lineHeight: 14 },

  catRow: { paddingHorizontal: theme.space.lg, paddingTop: theme.space.md, gap: theme.space.sm, backgroundColor: theme.color.bg },
  catChip: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  catChipActive: { backgroundColor: theme.color.primaryLight, borderColor: theme.color.primary },
  catChipText: { fontSize: theme.font.small, fontWeight: "600", color: theme.color.textMuted },
  catChipTextActive: { color: theme.color.primaryDark },

  infoStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.sm,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    backgroundColor: theme.color.bg,
  },

  rxCta: {
    backgroundColor: theme.color.card,
    marginHorizontal: theme.space.lg,
    marginTop: theme.space.lg,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    gap: theme.space.sm,
    borderWidth: 1.5,
    borderColor: theme.color.primary,
    ...shadow.sm,
  },
  rxCtaTitle: { fontSize: theme.font.h2, fontWeight: '800', color: theme.color.text },
  rxCtaSub: { fontSize: theme.font.body, color: theme.color.textMuted, lineHeight: 21, marginBottom: theme.space.sm },

  conflictBox: {
    margin: theme.space.lg,
    padding: theme.space.md,
    backgroundColor: theme.color.warningLight,
    borderRadius: theme.radius.md,
    gap: theme.space.sm,
  },
  conflictTitle: { fontSize: theme.font.body, fontWeight: "700", color: theme.color.warning },
  conflictMsg: { fontSize: theme.font.small, color: theme.color.text },
  conflictActions: { flexDirection: 'row', gap: theme.space.sm, flexWrap: 'wrap' },

  notice: {
    marginHorizontal: theme.space.lg,
    marginTop: theme.space.sm,
    color: theme.color.danger,
    fontSize: theme.font.small,
    fontWeight: "500",
  },

  sectionTitle: {
    fontSize: theme.font.h3,
    fontWeight: "700",
    color: theme.color.text,
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.lg,
    paddingBottom: theme.space.sm,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    gap: theme.space.md,
    backgroundColor: theme.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },

  // ── Product grid card ──
  productCard: {
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 10,
    backgroundColor: theme.color.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.color.border,
    ...shadow.sm,
  },
  productTapArea: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  detailBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  detailText: {
    fontSize: theme.font.small,
    color: theme.color.textMuted,
    lineHeight: 19,
  },
  detailEmpty: {
    fontSize: theme.font.small,
    color: theme.color.textFaint,
    fontStyle: 'italic',
  },
  productImageWrap: {
    position: 'relative',
    width: 84,
    height: 84,
    borderRadius: 12,
    overflow: 'hidden',
  },  productImage: {
    width: '100%',
    height: '100%',
  },
  inCartBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#E8F5E9',
    borderRadius: theme.radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  inCartText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#2E7D32',
  },
  productInfo: {
    flex: 1,
    gap: 4,
  },
  productActions: {
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  productName: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.color.text,
    lineHeight: 17,
  },
  productPopular: {
    fontSize: 10,
    color: '#E65100',
    fontWeight: '600',
  },
  productHint: {
    fontSize: 11,
    color: theme.color.primary,
    fontWeight: '600',
  },
  productPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    marginBottom: 6,
  },
  productPrice: {
    fontSize: 16,
    fontWeight: '900',
    color: theme.color.primary,
  },
  productMrp: {
    fontSize: 12,
    color: theme.color.textMuted,
    textDecorationLine: 'line-through',
  },
  addBtn: {
    alignSelf: 'flex-end',
    backgroundColor: theme.color.primary,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 20,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    minWidth: 92,
  },
  addBtnBusy: { opacity: 0.6 },
  addBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  outOfStockBadge: {
    alignSelf: 'flex-end',
    backgroundColor: theme.color.dangerLight,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  outOfStockText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.color.danger,
  },
  thumbWrap: { position: 'relative' },
  thumb: { width: 64, height: 64, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt },
  discountTag: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: theme.color.accent,
    borderTopLeftRadius: 15,
    borderBottomRightRadius: theme.radius.md,
    paddingHorizontal: 8,
    paddingVertical: 3,
    zIndex: 1,
  },
  discountText: { fontSize: theme.font.tiny, fontWeight: "700", color: '#fff' },

  info: { flex: 1, gap: 3 },
  name: { fontSize: theme.font.body, color: theme.color.text, fontWeight: "600" },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  price: { fontSize: theme.font.h3, color: theme.color.text, fontWeight: "700" },
  mrp: { fontSize: theme.font.small, color: theme.color.textMuted, textDecorationLine: 'line-through' },
  popular: { fontSize: theme.font.tiny, color: theme.color.warning, fontWeight: "500" },

  action: { minWidth: 92, alignItems: 'flex-end' },
  stepper: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.color.primary,
    borderRadius: 10,
    paddingVertical: 2,
  },
  stepBtn: { paddingHorizontal: 16, paddingVertical: 8 },
  stepText: { color: theme.color.onPrimary, fontSize: theme.font.h2, fontWeight: "700" },
  qty: { color: theme.color.onPrimary, fontWeight: "700", minWidth: 28, textAlign: 'center', fontSize: theme.font.body },

  empty: { color: theme.color.textMuted, textAlign: 'center', marginTop: theme.space.xl, paddingHorizontal: theme.space.lg },

  reviews: { paddingBottom: theme.space.xl },
  noReviews: { color: theme.color.textMuted, fontSize: theme.font.small, paddingHorizontal: theme.space.lg },
  reviewCard: {
    marginHorizontal: theme.space.lg,
    marginBottom: theme.space.xs,
    backgroundColor: theme.color.card,
    borderRadius: theme.radius.md,
    padding: theme.space.sm,
    ...shadow.sm,
  },
  reviewHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: theme.space.sm },
  reviewAuthor: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, flex: 1 },
  reviewAvatar: {
    width: 28,
    height: 28,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewAvatarText: { fontSize: theme.font.tiny, fontWeight: "700", color: theme.color.primaryDark },
  reviewName: { fontSize: theme.font.small, fontWeight: "600", color: theme.color.text },
  reviewMemberSince: { fontSize: 10, color: theme.color.textFaint },
  reviewStars: { color: theme.color.star, fontSize: theme.font.small, marginTop: theme.space.xs },
  reviewDate: { fontSize: theme.font.tiny, color: theme.color.textFaint },
  reviewComment: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 3 },
  reviewToggle: {
    alignSelf: 'center',
    marginTop: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  reviewToggleText: {
    fontSize: theme.font.small,
    fontWeight: "700",
    color: theme.color.primary,
  },

  cartBar: {
    position: 'absolute',
    left: theme.space.lg,
    right: theme.space.lg,
    bottom: theme.space.lg,
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    ...shadow.lg,
  },
  cartBarLeft: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
  cartCountPill: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: theme.radius.pill,
    minWidth: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  cartCountText: { color: theme.color.onPrimary, fontWeight: "700" },
  cartBarLabel: { color: '#D7F0E3', fontSize: theme.font.tiny, fontWeight: "500" },
  cartBarTotal: { color: theme.color.onPrimary, fontSize: theme.font.h3, fontWeight: "700" },
  cartBarArrow: { color: theme.color.onPrimary, fontWeight: "700", fontSize: theme.font.body },

  // Fullscreen image preview (lightbox)
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space.lg,
  },
  previewImage: { width: '100%', height: '70%' },
  previewName: {
    color: '#fff',
    fontSize: theme.font.h3,
    fontWeight: '700',
    marginTop: theme.space.lg,
    textAlign: 'center',
  },
  previewClose: {
    position: 'absolute',
    top: theme.space.xl,
    right: theme.space.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  previewCloseText: { color: '#fff', fontSize: 20, fontWeight: '700' },
});
