import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { PaymentMethod } from '@nearbaz/shared';
import type { POSSaleItem, POSCreateSale } from '@nearbaz/shared';
import { api, posSaleWithOutbox, flushPosOutbox } from '../api';
import {
  cacheCatalog,
  loadCachedCatalog,
  outboxCount,
  newId,
  type CachedProduct,
} from '../posOutbox';
import {
  isPrintingSupported,
  getSavedPrinter,
  listPairedPrinters,
  connectPrinter,
  printSale,
  PrintUnavailableError,
  type PrinterDevice,
} from '../print';
import type { PrintableSale, PaperWidth } from '../escpos';
import { formatRupees, paiseToRupeeInput, rupeeInputToPaise, theme } from '../theme';
import { useLang } from '../i18n/LanguageContext';
import type { MyShop } from '../types';

/** A line in the working bill: a catalog product or a typed custom item. */
interface CartLine {
  /** Stable key (productId for catalog lines, a local id for custom lines). */
  key: string;
  /** Catalog product id (absent for custom lines). */
  productId?: string;
  name: string;
  pricePaise: number;
  qty: number;
}

/**
 * PosScreen — in-store counter sale (POS). The shopkeeper picks catalog products
 * and/or types custom items, takes CASH, and prints a receipt (+ optional KOT)
 * to a Bluetooth thermal printer. Fully offline-capable: the sale is saved to a
 * durable outbox and the receipt printed locally the instant it's rung up; the
 * server write replays automatically when back online (exactly-once via the
 * sale's idempotencyKey).
 */
export function PosScreen({ shop }: { shop: MyShop }) {
  const { t } = useLang();
  const [catalog, setCatalog] = useState<CachedProduct[]>([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cashInput, setCashInput] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [withKot, setWithKot] = useState(false);
  const [paperWidth, setPaperWidth] = useState<PaperWidth>(58);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [lastPrintable, setLastPrintable] = useState<PrintableSale | null>(null);
  const [pending, setPending] = useState(0);

  // Printer state.
  const [printer, setPrinter] = useState<PrinterDevice | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<PrinterDevice[]>([]);

  const canPrint = isPrintingSupported();

  /** Load the catalog (online → cache; offline → cached), the saved printer, and the outbox count. */
  const bootstrap = useCallback(async () => {
    try {
      const products = (await api.myProducts()) as {
        id: string;
        name: string;
        pricePaise: number;
        available: boolean;
      }[];
      const mapped: CachedProduct[] = products.map((p) => ({
        id: p.id,
        name: p.name,
        pricePaise: p.pricePaise,
        available: p.available,
      }));
      setCatalog(mapped);
      void cacheCatalog(mapped);
    } catch {
      // Offline (or error) — fall back to the last cached catalog.
      setCatalog(await loadCachedCatalog());
    }
    if (canPrint) setPrinter(await getSavedPrinter());
    setPending(await outboxCount(shop.id));
    // Opportunistically flush anything queued from a previous offline session.
    void syncNow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPrint, shop.id]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const subtotalPaise = useMemo(
    () => cart.reduce((sum, l) => sum + l.pricePaise * l.qty, 0),
    [cart],
  );
  const cashPaise = rupeeInputToPaise(cashInput);
  const changePaise = cashInput.trim() && cashPaise >= subtotalPaise ? cashPaise - subtotalPaise : 0;

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = catalog.filter((p) => p.available);
    if (!q) return base.slice(0, 30);
    return base.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 30);
  }, [catalog, search]);

  function addCatalog(p: CachedProduct) {
    setMessage(null);
    setCart((prev) => {
      const found = prev.find((l) => l.productId === p.id);
      if (found) return prev.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { key: p.id, productId: p.id, name: p.name, pricePaise: p.pricePaise, qty: 1 }];
    });
  }

  function addCustomLine() {
    setMessage(null);
    setCart((prev) => [...prev, { key: newId('line'), name: '', pricePaise: 0, qty: 1 }]);
  }

  function updateLine(key: string, patch: Partial<CartLine>) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  function stepQty(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, qty: Math.max(0, l.qty + delta) } : l))
        .filter((l) => l.qty > 0),
    );
  }

  function resetSale() {
    setCart([]);
    setCashInput('');
    setPhone('');
    setNote('');
    setMessage(null);
    setLastPrintable(null);
  }

  /** Flush the offline outbox; `silent` suppresses the "nothing to sync" state noise. */
  async function syncNow(silent = false) {
    const before = await outboxCount(shop.id);
    if (before === 0) {
      setPending(0);
      return;
    }
    const res = await flushPosOutbox(shop.id);
    setPending(res.remaining);
    if (!silent && res.sent > 0) {
      setMessage({ tone: 'ok', text: t.pos.synced(res.sent) });
    }
  }

  async function openPrinterPicker() {
    setPickerOpen(true);
    setScanning(true);
    setDevices(await listPairedPrinters());
    setScanning(false);
  }

  async function pickPrinter(device: PrinterDevice) {
    try {
      await connectPrinter(device);
      setPrinter(device);
      setPickerOpen(false);
      setMessage({ tone: 'ok', text: t.pos.connected(device.name) });
    } catch {
      setMessage({ tone: 'err', text: t.pos.connectError });
    }
  }

  /** Build the request body + a locally-computed printable from the current bill. */
  function buildSale(): { body: POSCreateSale; printable: PrintableSale } {
    const items: POSSaleItem[] = cart.map((l) =>
      l.productId
        ? { productId: l.productId, qty: l.qty }
        : { name: l.name.trim(), pricePaise: l.pricePaise, qty: l.qty },
    );
    const idempotencyKey = newId('sale');
    const trimmedPhone = phone.trim();
    const trimmedNote = note.trim();
    const body: POSCreateSale = {
      items,
      paymentMethod: PaymentMethod.CASH,
      idempotencyKey,
      ...(cashInput.trim() ? { cashTenderedPaise: cashPaise } : {}),
      ...(trimmedPhone ? { customerPhone: trimmedPhone } : {}),
      ...(trimmedNote ? { notes: trimmedNote } : {}),
    };
    const printable: PrintableSale = {
      shopName: shop.name,
      billRef: idempotencyKey.slice(-8).toUpperCase(),
      createdAt: new Date().toISOString(),
      items: cart.map((l) => ({ name: l.name.trim(), qty: l.qty, pricePaise: l.pricePaise })),
      subtotalPaise,
      totalPaise: subtotalPaise,
      ...(cashInput.trim() ? { cashTenderedPaise: cashPaise, changePaise } : {}),
      ...(trimmedNote ? { notes: trimmedNote } : {}),
      ...(shop.addressLine ? { addressLine: shop.addressLine } : {}),
      ...(shop.contactPhone ? { contactPhone: shop.contactPhone } : {}),
    };
    return { body, printable };
  }

  /** Print a printable receipt (+ KOT), surfacing a friendly note on failure. */
  async function doPrint(printable: PrintableSale) {
    if (!canPrint) {
      setMessage({ tone: 'warn', text: t.pos.printUnavailable });
      return;
    }
    try {
      await printSale(printable, { width: paperWidth, withKot });
    } catch (err) {
      if (err instanceof PrintUnavailableError) {
        setMessage({ tone: 'warn', text: err.message });
      } else {
        setMessage({ tone: 'warn', text: t.pos.printError });
      }
    }
  }

  async function charge() {
    if (saving) return;
    // Validate the bill.
    if (cart.length === 0) {
      setMessage({ tone: 'err', text: t.pos.needItems });
      return;
    }
    for (const l of cart) {
      if (!l.productId && (!l.name.trim() || l.pricePaise <= 0)) {
        setMessage({ tone: 'err', text: t.pos.invalidCustom });
        return;
      }
    }
    if (cashInput.trim() && cashPaise < subtotalPaise) {
      setMessage({ tone: 'err', text: t.pos.cashShort });
      return;
    }

    setSaving(true);
    setMessage(null);
    const { body, printable } = buildSale();
    try {
      const outcome = await posSaleWithOutbox(shop.id, body);
      const finalPrintable: PrintableSale = {
        ...printable,
        queuedOffline: !outcome.synced,
        ...(outcome.result?.shortId ? { billRef: outcome.result.shortId } : {}),
      };
      setLastPrintable(finalPrintable);
      setPending(await outboxCount(shop.id));
      setMessage({
        tone: outcome.synced ? 'ok' : 'warn',
        text: outcome.synced ? t.pos.saleDone : t.pos.saleQueued,
      });
      await doPrint(finalPrintable);
      // Clear the working bill (keep the result banner + reprint available).
      setCart([]);
      setCashInput('');
      setPhone('');
      setNote('');
    } catch (err) {
      const text = err instanceof Error ? err.message : t.pos.saleError;
      setMessage({ tone: 'err', text });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t.pos.title}</Text>
      <Text style={styles.subtitle}>{t.pos.subtitle}</Text>

      {/* Pending-sync banner */}
      {pending > 0 ? (
        <View style={[styles.banner, styles.bannerWarn]}>
          <Text style={styles.bannerText}>{t.pos.pendingSync(pending)}</Text>
          <Pressable onPress={() => void syncNow()} style={styles.bannerBtn} hitSlop={6}>
            <Text style={styles.bannerBtnText}>{t.pos.syncNow}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Result / status message */}
      {message ? (
        <View
          style={[
            styles.banner,
            message.tone === 'ok' ? styles.bannerOk : message.tone === 'warn' ? styles.bannerWarn : styles.bannerErr,
          ]}
        >
          <Text style={styles.bannerText}>{message.text}</Text>
        </View>
      ) : null}

      {/* Reprint / new sale after a completed sale */}
      {lastPrintable ? (
        <View style={styles.resultRow}>
          <Pressable style={[styles.secondaryBtn, styles.flex1]} onPress={() => void doPrint(lastPrintable)}>
            <Text style={styles.secondaryBtnText}>{t.pos.reprint}</Text>
          </Pressable>
          <Pressable style={[styles.secondaryBtn, styles.flex1]} onPress={resetSale}>
            <Text style={styles.secondaryBtnText}>{t.pos.newSale}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Printer status (native only) */}
      {canPrint ? (
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>{t.pos.printerTitle}</Text>
            <Pressable onPress={() => void openPrinterPicker()} hitSlop={6}>
              <Text style={styles.linkText}>{printer ? t.pos.connectPrinter : t.pos.connectPrinter}</Text>
            </Pressable>
          </View>
          <Text style={styles.printerStatus}>
            {printer ? t.pos.connected(printer.name) : t.pos.printerNone}
          </Text>
          {pickerOpen ? (
            <View style={styles.picker}>
              <Text style={styles.pickerTitle}>{t.pos.selectPrinter}</Text>
              {scanning ? (
                <View style={styles.scanRow}>
                  <ActivityIndicator size="small" color={theme.color.accent} />
                  <Text style={styles.scanText}>{t.pos.scanning}</Text>
                </View>
              ) : devices.length === 0 ? (
                <Text style={styles.emptyText}>{t.pos.noPrinters}</Text>
              ) : (
                devices.map((d) => (
                  <Pressable key={d.address} style={styles.deviceRow} onPress={() => void pickPrinter(d)}>
                    <Text style={styles.deviceName}>{d.name}</Text>
                    <Text style={styles.deviceAddr}>{d.address}</Text>
                  </Pressable>
                ))
              )}
              <Pressable onPress={() => setPickerOpen(false)} hitSlop={6} style={styles.pickerClose}>
                <Text style={styles.linkText}>{t.common.cancel}</Text>
              </Pressable>
            </View>
          ) : null}
          {/* Paper width + KOT toggles */}
          <View style={styles.widthRow}>
            <Text style={styles.fieldLabel}>{t.pos.paperWidth}</Text>
            <View style={styles.segment}>
              {([58, 80] as PaperWidth[]).map((w) => (
                <Pressable
                  key={w}
                  onPress={() => setPaperWidth(w)}
                  style={[styles.segItem, paperWidth === w && styles.segItemActive]}
                >
                  <Text style={[styles.segText, paperWidth === w && styles.segTextActive]}>
                    {w === 58 ? t.pos.paper58 : t.pos.paper80}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      ) : null}

      {/* Catalog picker */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t.pos.searchPlaceholder}</Text>
        <TextInput
          style={styles.input}
          placeholder={t.pos.searchPlaceholder}
          placeholderTextColor={theme.color.textFaint}
          value={search}
          onChangeText={setSearch}
        />
        {catalog.length === 0 ? (
          <Text style={styles.emptyText}>{t.pos.noProducts}</Text>
        ) : (
          <View style={styles.productWrap}>
            {filteredCatalog.map((p) => (
              <Pressable key={p.id} style={styles.productChip} onPress={() => addCatalog(p)}>
                <Text style={styles.productChipName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.productChipPrice}>{formatRupees(p.pricePaise)}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* The working bill */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>{t.pos.cartTitle}</Text>
          <Pressable onPress={addCustomLine} hitSlop={6}>
            <Text style={styles.linkText}>{t.pos.addLine}</Text>
          </Pressable>
        </View>
        {cart.length === 0 ? (
          <Text style={styles.emptyText}>{t.pos.cartEmpty}</Text>
        ) : (
          cart.map((l) => (
            <View key={l.key} style={styles.cartLine}>
              {l.productId ? (
                <Text style={styles.cartName} numberOfLines={1}>{l.name}</Text>
              ) : (
                <TextInput
                  style={[styles.input, styles.cartNameInput]}
                  placeholder={t.pos.itemNamePlaceholder}
                  placeholderTextColor={theme.color.textFaint}
                  value={l.name}
                  onChangeText={(v) => updateLine(l.key, { name: v })}
                />
              )}
              <View style={styles.cartControls}>
                {l.productId ? (
                  <Text style={styles.cartPrice}>{formatRupees(l.pricePaise)}</Text>
                ) : (
                  <TextInput
                    style={[styles.input, styles.priceInput]}
                    placeholder={t.pos.zeroPlaceholder}
                    placeholderTextColor={theme.color.textFaint}
                    keyboardType="decimal-pad"
                    value={paiseToRupeeInput(l.pricePaise)}
                    onChangeText={(v) => updateLine(l.key, { pricePaise: rupeeInputToPaise(v) })}
                  />
                )}
                <View style={styles.qtyRow}>
                  <Pressable style={styles.qtyBtn} onPress={() => stepQty(l.key, -1)} hitSlop={4}>
                    <Text style={styles.qtyBtnText}>−</Text>
                  </Pressable>
                  <Text style={styles.qtyValue}>{l.qty}</Text>
                  <Pressable style={styles.qtyBtn} onPress={() => stepQty(l.key, 1)} hitSlop={4}>
                    <Text style={styles.qtyBtnText}>+</Text>
                  </Pressable>
                </View>
                <Text style={styles.lineTotal}>{formatRupees(l.pricePaise * l.qty)}</Text>
                <Pressable onPress={() => removeLine(l.key)} hitSlop={6}>
                  <Text style={styles.removeText}>✕</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Payment (cash only) + optional capture fields */}
      <View style={styles.card}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t.pos.subtotal}</Text>
          <Text style={styles.totalValue}>{formatRupees(subtotalPaise)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={[styles.totalLabel, styles.grandLabel]}>{t.pos.total}</Text>
          <Text style={[styles.totalValue, styles.grandValue]}>{formatRupees(subtotalPaise)}</Text>
        </View>

        <Text style={styles.fieldLabel}>{t.pos.cashLabel}</Text>
        <TextInput
          style={styles.input}
          placeholder={t.pos.zeroPlaceholder}
          placeholderTextColor={theme.color.textFaint}
          keyboardType="decimal-pad"
          value={cashInput}
          onChangeText={setCashInput}
        />
        {cashInput.trim() && cashPaise >= subtotalPaise ? (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t.pos.change}</Text>
            <Text style={styles.totalValue}>{formatRupees(changePaise)}</Text>
          </View>
        ) : null}

        <Text style={styles.fieldLabel}>{t.pos.customerPhone}</Text>
        <TextInput
          style={styles.input}
          placeholder={t.pos.phonePlaceholder}
          placeholderTextColor={theme.color.textFaint}
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
        />

        <Text style={styles.fieldLabel}>{t.pos.notes}</Text>
        <TextInput
          style={styles.input}
          placeholder={t.pos.notesPlaceholder}
          placeholderTextColor={theme.color.textFaint}
          value={note}
          onChangeText={setNote}
        />

        {canPrint ? (
          <View style={styles.kotRow}>
            <Text style={styles.fieldLabel}>{t.pos.printKot}</Text>
            <Switch
              value={withKot}
              onValueChange={setWithKot}
              trackColor={{ false: theme.color.borderStrong, true: theme.color.accent }}
              thumbColor={theme.color.white}
            />
          </View>
        ) : null}
      </View>

      <Pressable
        style={[styles.chargeBtn, (saving || cart.length === 0) && styles.chargeBtnDisabled]}
        onPress={() => void charge()}
        disabled={saving || cart.length === 0}
      >
        {saving ? (
          <ActivityIndicator color={theme.color.white} />
        ) : (
          <Text style={styles.chargeBtnText}>{t.pos.charge(formatRupees(subtotalPaise))}</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  content: { padding: theme.space.lg, gap: theme.space.md, paddingBottom: theme.space.xxxl },
  title: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text },
  subtitle: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: -theme.space.sm },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space.md,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  bannerOk: { backgroundColor: theme.color.successSoft },
  bannerWarn: { backgroundColor: theme.color.warningSoft },
  bannerErr: { backgroundColor: theme.color.dangerSoft },
  bannerText: { flex: 1, fontSize: theme.font.small, color: theme.color.text, fontWeight: '600' },
  bannerBtn: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.md,
    paddingVertical: 4,
  },
  bannerBtnText: { color: theme.color.white, fontWeight: '800', fontSize: theme.font.tiny },

  resultRow: { flexDirection: 'row', gap: theme.space.md },
  flex1: { flex: 1 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: theme.color.accent,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.md,
    alignItems: 'center',
  },
  secondaryBtnText: { color: theme.color.accent, fontWeight: '800', fontSize: theme.font.body },

  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: theme.font.body, fontWeight: '800', color: theme.color.text },
  linkText: { color: theme.color.accent, fontWeight: '800', fontSize: theme.font.small },

  printerStatus: { fontSize: theme.font.small, color: theme.color.textMuted },
  picker: { gap: theme.space.xs, borderTopWidth: 1, borderTopColor: theme.color.border, paddingTop: theme.space.sm },
  pickerTitle: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  pickerClose: { alignSelf: 'flex-start', paddingVertical: theme.space.xs },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, paddingVertical: theme.space.xs },
  scanText: { fontSize: theme.font.small, color: theme.color.textMuted },
  deviceRow: {
    paddingVertical: theme.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  deviceName: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  deviceAddr: { fontSize: theme.font.tiny, color: theme.color.textFaint },

  widthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: theme.space.xs },
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.md, overflow: 'hidden' },
  segItem: { paddingHorizontal: theme.space.md, paddingVertical: theme.space.xs },
  segItemActive: { backgroundColor: theme.color.accent },
  segText: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.textMuted },
  segTextActive: { color: theme.color.white },

  input: {
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    fontSize: theme.font.body,
    color: theme.color.text,
    backgroundColor: theme.color.surface,
  },
  emptyText: { fontSize: theme.font.small, color: theme.color.textMuted, paddingVertical: theme.space.sm },

  productWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  productChip: {
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    maxWidth: 200,
  },
  productChipName: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  productChipPrice: { fontSize: theme.font.tiny, color: theme.color.accent, fontWeight: '800', marginTop: 2 },

  cartLine: { gap: theme.space.xs, borderBottomWidth: 1, borderBottomColor: theme.color.border, paddingBottom: theme.space.sm },
  cartName: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  cartNameInput: { flex: 1 },
  cartControls: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  cartPrice: { fontSize: theme.font.small, color: theme.color.textMuted, minWidth: 64 },
  priceInput: { width: 90, paddingVertical: theme.space.xs },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.accent },
  qtyValue: { fontSize: theme.font.body, fontWeight: '800', color: theme.color.text, minWidth: 20, textAlign: 'center' },
  lineTotal: { flex: 1, textAlign: 'right', fontSize: theme.font.small, fontWeight: '800', color: theme.color.text },
  removeText: { fontSize: theme.font.body, color: theme.color.danger, fontWeight: '800', paddingHorizontal: 4 },

  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { fontSize: theme.font.small, color: theme.color.textMuted },
  totalValue: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  grandLabel: { fontSize: theme.font.body, fontWeight: '900', color: theme.color.text },
  grandValue: { fontSize: theme.font.h3, fontWeight: '900', color: theme.color.accent },

  fieldLabel: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text, marginTop: theme.space.xs },
  kotRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: theme.space.xs },

  chargeBtn: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.lg,
    paddingVertical: theme.space.lg,
    alignItems: 'center',
    ...theme.shadow.sm,
  },
  chargeBtnDisabled: { opacity: 0.5 },
  chargeBtnText: { color: theme.color.white, fontWeight: '900', fontSize: theme.font.h3 },
});
