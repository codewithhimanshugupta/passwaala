import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { api } from '../api';
import { formatRupees, placeholderImage, resolveImage, rupeeInputToPaise, theme } from '../theme';
import { Badge, Button, Card, Chip, ErrorText, Field } from '../ui';
import { ImagePicker } from '../components/ImagePicker';
import { useLang } from '../i18n/LanguageContext';
import type { Strings } from '../i18n/strings';
import type { MyProduct } from '../types';

/** A shopkeeper's own product category. */
interface Category {
  id: string;
  name: string;
}

/**
 * ProductsScreen — catalog management. Lists the shop's own products
 * (thumbnail, price/MRP strike-through, stock, availability badge), a
 * Categories manager (add/delete), and an add-form (modal) that converts rupees
 * → integer paise and can assign a category. Every mutation re-fetches so the
 * list is server-authoritative.
 */
export function ProductsScreen() {
  const { t } = useLang();
  const [products, setProducts] = useState<MyProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  // The product currently being edited (null when adding a new one).
  const [editing, setEditing] = useState<MyProduct | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      const [prods, cats] = await Promise.all([
        api.myProducts() as Promise<MyProduct[]>,
        api.myCategories() as Promise<Category[]>,
      ]);
      setProducts(prods);
      setCategories(cats);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    setDeletingId(id);
    setError(null);
    // Optimistic: drop the product from the list immediately; restore it (and
    // show the error) if the server delete fails.
    const prev = products;
    setProducts((list) => list.filter((p) => p.id !== id));
    try {
      await api.deleteProduct(id);
    } catch (e) {
      setProducts(prev); // rollback
      setError((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.color.accent} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.headerBar}>
        <View>
          <Text style={styles.title}>{t.products.title}</Text>
          <Text style={styles.subtitle}>{t.products.countSub(products.length)}</Text>
        </View>
        <Button label={t.products.add} small onPress={() => { setEditing(null); setFormOpen(true); }} />
      </View>

      {error ? <View style={styles.errorWrap}><ErrorText>{error}</ErrorText></View> : null}

      <FlatList
        contentContainerStyle={styles.list}
        data={products}
        keyExtractor={(p) => p.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.color.accent} />
        }
        ListHeaderComponent={
          <CategoryManager categories={categories} onChanged={load} t={t} />
        }
        ListEmptyComponent={<Text style={styles.empty}>{t.products.empty}</Text>}
        renderItem={({ item }) => (
          <ProductRow
            product={item}
            deleting={deletingId === item.id}
            t={t}
            onEdit={() => { setEditing(item); setFormOpen(true); }}
            onDelete={() => remove(item.id)}
          />
        )}
      />

      <ProductFormModal
        visible={formOpen}
        product={editing}
        categories={categories}
        t={t}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSaved={async () => {
          setFormOpen(false);
          setEditing(null);
          await load();
        }}
      />
    </View>
  );
}

/** A compact categories manager: list chips, add a new one, delete on tap. */
function CategoryManager({ categories, onChanged, t }: { categories: Category[]; onChanged: () => Promise<void>; t: Strings }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function add() {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError(t.products.enterCategoryName);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createCategory(trimmed);
      setName('');
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      await api.deleteCategory(id);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card style={styles.catCard}>
      <Text style={styles.catTitle}>{t.products.categoriesTitle}</Text>
      <Text style={styles.catHint}>
        {t.products.categoriesHint}
      </Text>
      {categories.length > 0 ? (
        <View style={styles.catChips}>
          {categories.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => remove(c.id)}
              disabled={deletingId === c.id}
              style={({ pressed }) => [styles.catChip, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.catChipText}>{c.name}</Text>
              <Text style={styles.catChipX}>{deletingId === c.id ? '…' : '✕'}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.catEmpty}>{t.products.noCategories}</Text>
      )}
      <View style={styles.catAddRow}>
        <View style={styles.flex}>
          <Field placeholder={t.products.newCategoryPlaceholder} value={name} onChangeText={setName} />
        </View>
        <Button label={t.products.addCategory} small onPress={add} busy={busy} />
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}

function ProductRow({
  product,
  deleting,
  t,
  onEdit,
  onDelete,
}: {
  product: MyProduct;
  deleting: boolean;
  t: Strings;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const img = resolveImage(product.imageUrl, product.id || product.name, 160, 160);
  const showMrp = product.mrpPaise > product.pricePaise;
  return (
    <View style={[styles.card, theme.shadow.sm]}>
      <Image source={{ uri: img }} style={styles.thumb} />
      <View style={styles.cardBody}>
        <Text style={styles.name} numberOfLines={1}>{product.name}</Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatRupees(product.pricePaise)}</Text>
          {showMrp ? <Text style={styles.mrp}>{formatRupees(product.mrpPaise)}</Text> : null}
        </View>
        <View style={styles.metaRow}>
          <Badge
            label={product.available && product.stock > 0 ? t.products.available : product.stock <= 0 ? t.products.outOfStock : t.products.hidden}
            tone={product.available && product.stock > 0 ? 'success' : product.stock <= 0 ? 'danger' : 'neutral'}
          />
          <Text style={styles.stock}>{t.products.stock(product.stock)}</Text>
          {product.weightGrams ? <Text style={styles.stock}>{product.weightGrams}g</Text> : <Text style={[styles.stock, { color: theme.color.warning }]}>No weight set</Text>}
        </View>
      </View>
      <View style={styles.rowActions}>
        <Pressable onPress={onEdit} disabled={deleting} style={styles.editBtn} hitSlop={8}>
          <Text style={styles.edit}>{t.products.edit}</Text>
        </Pressable>
        <Pressable onPress={onDelete} disabled={deleting} style={styles.deleteBtn} hitSlop={8}>
          <Text style={styles.delete}>{t.products.delete}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Product create/edit modal. When `product` is null it creates (POST); when a
 * product is passed it prefills every field and saves via updateProduct (PATCH).
 * Either way the parent re-fetches on save so the list stays server-authoritative.
 */
function ProductFormModal({
  visible,
  product,
  categories,
  t,
  onClose,
  onSaved,
}: {
  visible: boolean;
  product: MyProduct | null;
  categories: Category[];
  t: Strings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = product !== null;
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [mrp, setMrp] = useState('');
  const [stock, setStock] = useState('');
  const [weight, setWeight] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [description, setDescription] = useState('');
  const [available, setAvailable] = useState(true);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form whenever the modal opens or the target product changes:
  // prefill from the product in edit mode, or blank fields in create mode.
  useEffect(() => {
    if (!visible) return;
    setError(null);
    if (product) {
      setName(product.name);
      setPrice(String(product.pricePaise / 100));
      setMrp(String(product.mrpPaise / 100));
      setStock(String(product.stock));
      setWeight(product.weightGrams ? String(product.weightGrams) : '');
      setImageUrl(product.imageUrl ?? '');
      setDescription(product.description ?? '');
      setAvailable(product.available);
      setCategoryId(product.categoryId ?? null);
    } else {
      setName('');
      setPrice('');
      setMrp('');
      setStock('');
      setWeight('');
      setImageUrl('');
      setDescription('');
      setAvailable(true);
      setCategoryId(null);
    }
  }, [visible, product]);

  async function save() {
    const priceNum = Number(price);
    const mrpNum = Number(mrp || price);
    const stockNum = Number(stock || '0');
    const weightNum = Number(weight);
    if (!name.trim() || !priceNum || priceNum <= 0) {
      setError(t.products.nameAndPriceRequired);
      return;
    }
    if (mrpNum < priceNum) {
      setError(t.products.mrpTooLow);
      return;
    }
    if (!weightNum || weightNum <= 0) {
      setError('Weight in grams is required (e.g. 500 for 500g, 1000 for 1kg)');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        pricePaise: Math.round(priceNum * 100),
        mrpPaise: Math.round(mrpNum * 100),
        stock: stockNum,
        weightGrams: Math.round(weightNum),
        imageUrl: imageUrl.trim() || undefined,
        description: description.trim() || undefined,
        available,
        categoryId: categoryId ?? undefined,
      };
      if (product) {
        await api.updateProduct(product.id, body);
      } else {
        await api.createProduct(body);
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Card style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{isEdit ? t.products.editProduct : t.products.addProduct}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <Field label={t.products.productName} placeholder={t.products.productNamePlaceholder} value={name} onChangeText={setName} />
          <View style={styles.row}>
            <View style={styles.flex}>
              <Field label={t.products.price} placeholder={t.products.zeroPlaceholder} keyboardType="decimal-pad" value={price} onChangeText={setPrice} />
            </View>
            <View style={styles.flex}>
              <Field label={t.products.mrp} placeholder={t.products.zeroPlaceholder} keyboardType="decimal-pad" value={mrp} onChangeText={setMrp} />
            </View>
            <View style={styles.flex}>
              <Field label={t.products.stockLabel} placeholder={t.products.zeroPlaceholder} keyboardType="number-pad" value={stock} onChangeText={setStock} />
            </View>
          </View>

          <Field
            label="Weight (grams) *"
            placeholder="e.g. 500 for 500g, 1000 for 1kg"
            keyboardType="number-pad"
            value={weight}
            onChangeText={setWeight}
          />

          <Field
            label="Description (optional)"
            placeholder="Longer details customers see when they tap the product"
            value={description}
            onChangeText={setDescription}
            multiline
          />

          <View style={styles.availRow}>
            <View style={styles.flex}>
              <Text style={styles.pickerLabel}>{t.products.availableToCustomers}</Text>
              <Text style={styles.availHint}>{t.products.availableHint}</Text>
            </View>
            <Switch
              value={available}
              onValueChange={setAvailable}
              trackColor={{ false: theme.color.borderStrong, true: theme.color.primary }}
              thumbColor={theme.color.white}
            />
          </View>

          {categories.length > 0 ? (
            <View style={styles.pickerWrap}>
              <Text style={styles.pickerLabel}>{t.products.categoryOptional}</Text>
              <View style={styles.pickerChips}>
                <Chip label={t.products.none} selected={categoryId === null} onPress={() => setCategoryId(null)} />
                {categories.map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    selected={categoryId === c.id}
                    onPress={() => setCategoryId(c.id)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <ImagePicker
            label={t.products.productImage}
            value={imageUrl.trim() || null}
            onUploaded={setImageUrl}
            hint={t.products.productImageHint}
            uploadType="product"
            scopeId={product?.shopId}
          />

          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button label={isEdit ? t.products.saveChanges : t.products.addProductBtn} onPress={save} busy={saving} />
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.md,
  },
  title: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text },
  subtitle: { fontSize: theme.font.small, color: theme.color.textMuted },

  errorWrap: { paddingHorizontal: theme.space.lg, paddingTop: theme.space.sm },
  list: { padding: theme.space.lg, gap: theme.space.md },

  catCard: { gap: theme.space.sm, marginBottom: theme.space.md },
  catTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  catHint: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  catChips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.xs,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    backgroundColor: theme.color.accentSoft,
    borderWidth: 1,
    borderColor: theme.color.accentSoft,
  },
  catChipText: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.accent },
  catChipX: { fontSize: theme.font.tiny, fontWeight: '800', color: theme.color.accent },
  catEmpty: { fontSize: theme.font.small, color: theme.color.textFaint },
  catAddRow: { flexDirection: 'row', alignItems: 'flex-end', gap: theme.space.sm },

  pickerWrap: { gap: theme.space.sm },
  pickerLabel: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.text },
  pickerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  thumb: { width: 60, height: 60, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt },
  cardBody: { flex: 1, gap: theme.space.xs },
  name: { fontWeight: '700', fontSize: theme.font.body, color: theme.color.text },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: theme.space.sm },
  price: { fontWeight: '800', color: theme.color.text, fontSize: theme.font.body },
  mrp: { color: theme.color.textFaint, fontSize: theme.font.small, textDecorationLine: 'line-through' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  stock: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  rowActions: { alignItems: 'flex-end', gap: theme.space.sm },
  editBtn: { paddingHorizontal: theme.space.sm },
  edit: { color: theme.color.accent, fontWeight: '700', fontSize: theme.font.small },
  deleteBtn: { paddingHorizontal: theme.space.sm },
  delete: { color: theme.color.danger, fontWeight: '700', fontSize: theme.font.small },

  availRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
  availHint: { fontSize: theme.font.tiny, color: theme.color.textMuted },

  empty: { color: theme.color.textMuted, textAlign: 'center', marginTop: theme.space.xxl },

  modalOverlay: { flex: 1, backgroundColor: theme.color.overlay, justifyContent: 'flex-end' },
  modalCard: {
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    gap: theme.space.md,
    width: '100%',
    maxWidth: theme.maxContentWidth,
    alignSelf: 'center',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text },
  close: { fontSize: 20, color: theme.color.textMuted, fontWeight: '700' },
  row: { flexDirection: 'row', gap: theme.space.sm },
  flex: { flex: 1 },
});
