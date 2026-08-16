import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { PrescriptionView, PrescriptionStatus } from '@nearbaz/shared';
import { api } from '../api';
import { onSocket } from '../socket';
import { formatRupees, resolveImage, rupeeInputToPaise, theme } from '../theme';
import { Badge, Button, Card, ErrorText, Field } from '../ui';
import type { BadgeTone } from '../ui';
import { useLang } from '../i18n/LanguageContext';
import type { Strings } from '../i18n/strings';

/**
 * PrescriptionsScreen — the medical-store prescription queue + build-bill editor.
 * A shopkeeper sees this shop's incoming prescriptions (SUBMITTED first, newest
 * first), taps one to view the uploaded Rx image(s) + customer note, then either
 * builds an itemized bill (free-text name + price₹ + qty rows with a live
 * subtotal) that is submitted via quotePrescription, or rejects it with a reason.
 *
 * The screen is a tiny two-view stack: the queue list and a single-prescription
 * detail, kept in local state (no react-navigation in this app).
 */
export function PrescriptionsScreen() {
  const { t } = useLang();
  const [items, setItems] = useState<PrescriptionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  // The prescription currently open in the detail view (null = show the queue).
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      const list = await api.shopPrescriptions();
      setItems(list);
      setForbidden(false);
    } catch (e) {
      // A 403 means this shop isn't a medical store — show the gate, not an error.
      if ((e as { status?: number })?.status === 403) setForbidden(true);
      else setError((e as Error).message || t.prescriptions.loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // Live refresh: a new Rx (or a status change) for this shop pushes over the
  // socket → reload the queue immediately (same pattern as the orders feed).
  useEffect(() => {
    const offCreated = onSocket('prescription.created', () => { void load(); });
    return () => { offCreated(); };
  }, [load]);

  // SUBMITTED (pending) first, then newest-first within each group.
  const sorted = useMemo(() => {
    const rank = (s: PrescriptionStatus) => (s === 'SUBMITTED' ? 0 : 1);
    return [...items].sort((a, b) => {
      const r = rank(a.status) - rank(b.status);
      if (r !== 0) return r;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [items]);

  const selected = selectedId ? items.find((p) => p.id === selectedId) ?? null : null;

  // Merge a mutated prescription (from quote/reject) back into the list.
  function applyUpdate(updated: PrescriptionView) {
    setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.color.accent} />
      </View>
    );
  }

  if (forbidden) {
    return (
      <View style={styles.center}>
        <Card style={styles.forbiddenCard}>
          <Text style={styles.forbiddenTitle}>{t.prescriptions.forbiddenTitle}</Text>
          <Text style={styles.forbiddenBody}>{t.prescriptions.forbiddenBody}</Text>
        </Card>
      </View>
    );
  }

  if (selected) {
    return (
      <PrescriptionDetail
        prescription={selected}
        t={t}
        onBack={() => setSelectedId(null)}
        onUpdated={(updated) => {
          applyUpdate(updated);
          setSelectedId(null);
        }}
      />
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.headerBar}>
        <Text style={styles.title}>{t.prescriptions.title}</Text>
        <Text style={styles.subtitle}>{t.prescriptions.subtitle(items.length)}</Text>
      </View>

      {error ? <View style={styles.errorWrap}><ErrorText>{error}</ErrorText></View> : null}

      <FlatList
        contentContainerStyle={styles.list}
        data={sorted}
        keyExtractor={(p) => p.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.color.accent} />
        }
        ListEmptyComponent={<Text style={styles.empty}>{t.prescriptions.empty}</Text>}
        renderItem={({ item }) => (
          <QueueRow prescription={item} t={t} onOpen={() => setSelectedId(item.id)} />
        )}
      />
    </View>
  );
}

/** Map a prescription status to its localized label + badge tone. */
function statusMeta(status: PrescriptionStatus, t: Strings): { label: string; tone: BadgeTone } {
  switch (status) {
    case 'SUBMITTED':
      return { label: t.prescriptions.statusSubmitted, tone: 'info' };
    case 'QUOTED':
      return { label: t.prescriptions.statusQuoted, tone: 'warning' };
    case 'CONVERTED':
      return { label: t.prescriptions.statusConverted, tone: 'success' };
    case 'REJECTED':
      return { label: t.prescriptions.statusRejected, tone: 'danger' };
    default:
      return { label: status, tone: 'neutral' };
  }
}

/** Short local date-time, e.g. "16 Aug, 10:32". */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function QueueRow({ prescription, t, onOpen }: { prescription: PrescriptionView; t: Strings; onOpen: () => void }) {
  const meta = statusMeta(prescription.status, t);
  const ref = prescription.shortId || prescription.id.slice(0, 8).toUpperCase();
  const thumb = prescription.imageUrls[0]
    ? resolveImage(prescription.imageUrls[0], prescription.id, 160, 160)
    : null;
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [styles.card, theme.shadow.sm, pressed && { opacity: 0.7 }]}
    >
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]} />
      )}
      <View style={styles.cardBody}>
        <Text style={styles.ref}>{t.prescriptions.ref(ref)}</Text>
        <Text style={styles.when}>{t.prescriptions.submittedAt(formatWhen(prescription.createdAt))}</Text>
        {prescription.note ? (
          <Text style={styles.notePreview} numberOfLines={1}>{prescription.note}</Text>
        ) : null}
        <View style={styles.metaRow}>
          <Badge label={meta.label} tone={meta.tone} />
          <Text style={styles.imgCount}>{t.prescriptions.imageCount(prescription.imageUrls.length)}</Text>
        </View>
      </View>
      <Text style={styles.arrow}>›</Text>
    </Pressable>
  );
}

/* --------------------------- Detail / build bill -------------------------- */

interface BillRow {
  key: string;
  name: string;
  price: string;
  qty: string;
}

function newRow(): BillRow {
  return { key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: '', price: '', qty: '1' };
}

/** A uuid-ish idempotency key for a single quote submission. */
function makeIdempotencyKey(): string {
  return `rx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

function PrescriptionDetail({
  prescription,
  t,
  onBack,
  onUpdated,
}: {
  prescription: PrescriptionView;
  t: Strings;
  onBack: () => void;
  onUpdated: (updated: PrescriptionView) => void;
}) {
  const [rows, setRows] = useState<BillRow[]>([newRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  const editable = prescription.status === 'SUBMITTED';
  const ref = prescription.shortId || prescription.id.slice(0, 8).toUpperCase();

  // Live subtotal in paise from the current rows.
  const subtotalPaise = useMemo(
    () =>
      rows.reduce((sum, r) => {
        const price = rupeeInputToPaise(r.price);
        const qty = Math.max(0, Math.floor(Number(r.qty) || 0));
        return sum + price * qty;
      }, 0),
    [rows],
  );

  function updateRow(key: string, patch: Partial<BillRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }

  function removeRow(key: string) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));
  }

  async function submitQuote() {
    const parsed = rows
      .map((r) => ({
        name: r.name.trim(),
        pricePaise: rupeeInputToPaise(r.price),
        quantity: Math.floor(Number(r.qty) || 0),
      }))
      .filter((r) => r.name || r.pricePaise > 0);
    if (parsed.length === 0) {
      setError(t.prescriptions.needOneItem);
      return;
    }
    if (parsed.some((r) => !r.name || r.pricePaise <= 0 || r.quantity < 1)) {
      setError(t.prescriptions.invalidItem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.quotePrescription(prescription.id, {
        items: parsed,
        idempotencyKey: makeIdempotencyKey(),
      });
      onUpdated(updated);
    } catch (e) {
      setError((e as Error).message || t.prescriptions.quoteError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
      <Pressable onPress={onBack} hitSlop={8} style={styles.backBtn}>
        <Text style={styles.backText}>{t.prescriptions.back}</Text>
      </Pressable>

      <View style={styles.detailHeader}>
        <Text style={styles.detailRef}>{t.prescriptions.ref(ref)}</Text>
        <Badge {...statusMeta(prescription.status, t)} />
      </View>
      <Text style={styles.when}>{t.prescriptions.submittedAt(formatWhen(prescription.createdAt))}</Text>

      {/* Rx images */}
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>{t.prescriptions.rxImages}</Text>
        {prescription.imageUrls.length > 0 ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.imageRow}>
              {prescription.imageUrls.map((url, i) => (
                <Pressable key={`${url}-${i}`} onPress={() => setViewerUrl(resolveImage(url, prescription.id, 1000, 1400))}>
                  <Image source={{ uri: resolveImage(url, prescription.id, 400, 560) }} style={styles.rxImage} />
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.hint}>{t.prescriptions.viewImage}</Text>
          </>
        ) : (
          <Text style={styles.hint}>{t.prescriptions.imageCount(0)}</Text>
        )}
      </Card>

      {/* Customer note */}
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>{t.prescriptions.customerNote}</Text>
        <Text style={prescription.note ? styles.noteText : styles.hint}>
          {prescription.note || t.prescriptions.noNote}
        </Text>
      </Card>

      {prescription.status === 'REJECTED' && prescription.rejectionReason ? (
        <Card style={styles.section}>
          <Text style={styles.rejectedReason}>{t.prescriptions.rejectionReason(prescription.rejectionReason)}</Text>
        </Card>
      ) : null}

      {editable ? (
        <>
          {/* Build-bill editor */}
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>{t.prescriptions.buildBill}</Text>
            <Text style={styles.hint}>{t.prescriptions.buildBillHint}</Text>

            {rows.map((row) => {
              const lineTotal = rupeeInputToPaise(row.price) * Math.max(0, Math.floor(Number(row.qty) || 0));
              return (
                <View key={row.key} style={styles.billRow}>
                  <Field
                    label={t.prescriptions.itemName}
                    placeholder={t.prescriptions.itemNamePlaceholder}
                    value={row.name}
                    onChangeText={(v) => updateRow(row.key, { name: v })}
                  />
                  <View style={styles.billRowInputs}>
                    <View style={styles.flex}>
                      <Field
                        label={t.prescriptions.unitPrice}
                        placeholder={t.prescriptions.zeroPlaceholder}
                        keyboardType="decimal-pad"
                        value={row.price}
                        onChangeText={(v) => updateRow(row.key, { price: v })}
                      />
                    </View>
                    <View style={styles.qtyCol}>
                      <Field
                        label={t.prescriptions.qty}
                        placeholder={t.prescriptions.onePlaceholder}
                        keyboardType="number-pad"
                        value={row.qty}
                        onChangeText={(v) => updateRow(row.key, { qty: v.replace(/[^0-9]/g, '') })}
                      />
                    </View>
                  </View>
                  <View style={styles.billRowFooter}>
                    <Text style={styles.lineTotal}>{t.prescriptions.lineTotal(formatRupees(lineTotal))}</Text>
                    {rows.length > 1 ? (
                      <Pressable onPress={() => removeRow(row.key)} hitSlop={6}>
                        <Text style={styles.removeItem}>{t.prescriptions.removeItem}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}

            <Pressable onPress={addRow} style={styles.addItemBtn}>
              <Text style={styles.addItemText}>{t.prescriptions.addItem}</Text>
            </Pressable>

            <Text style={styles.autoFeeNote}>{t.prescriptions.deliveryAutoNote}</Text>

            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>{t.prescriptions.subtotal}</Text>
              <Text style={styles.subtotalValue}>{formatRupees(subtotalPaise)}</Text>
            </View>

            {error ? <ErrorText>{error}</ErrorText> : null}

            <Button label={t.prescriptions.sendQuote} onPress={submitQuote} busy={saving} />
            <Button label={t.prescriptions.reject} variant="outline" onPress={() => setRejectOpen(true)} />
          </Card>
        </>
      ) : (
        <Card style={styles.section}>
          <Text style={styles.hint}>
            {prescription.status === 'REJECTED' ? t.prescriptions.alreadyRejected : t.prescriptions.alreadyQuoted}
          </Text>
        </Card>
      )}

      {/* Full-screen image viewer */}
      <Modal visible={viewerUrl !== null} transparent animationType="fade" onRequestClose={() => setViewerUrl(null)}>
        <Pressable style={styles.viewerOverlay} onPress={() => setViewerUrl(null)}>
          {viewerUrl ? <Image source={{ uri: viewerUrl }} style={styles.viewerImage} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>

      {/* Reject reason modal */}
      <RejectModal
        visible={rejectOpen}
        t={t}
        onClose={() => setRejectOpen(false)}
        onRejected={(updated) => {
          setRejectOpen(false);
          onUpdated(updated);
        }}
        prescriptionId={prescription.id}
      />
    </ScrollView>
  );
}

function RejectModal({
  visible,
  prescriptionId,
  t,
  onClose,
  onRejected,
}: {
  visible: boolean;
  prescriptionId: string;
  t: Strings;
  onClose: () => void;
  onRejected: (updated: PrescriptionView) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setReason('');
      setError(null);
    }
  }, [visible]);

  async function submit() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError(t.prescriptions.needReason);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.rejectPrescription(prescriptionId, { reason: trimmed });
      onRejected(updated);
    } catch (e) {
      setError((e as Error).message || t.prescriptions.rejectError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Card style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t.prescriptions.rejectTitle}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>{t.prescriptions.rejectSub}</Text>
          <Field
            placeholder={t.prescriptions.rejectPlaceholder}
            value={reason}
            onChangeText={setReason}
            multiline
            autoFocus
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button label={t.prescriptions.rejectConfirm} variant="danger" onPress={submit} busy={busy} />
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space.lg },

  headerBar: { paddingHorizontal: theme.space.lg, paddingTop: theme.space.md },
  title: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text },
  subtitle: { fontSize: theme.font.small, color: theme.color.textMuted },

  errorWrap: { paddingHorizontal: theme.space.lg, paddingTop: theme.space.sm },
  list: { padding: theme.space.lg, gap: theme.space.md },
  empty: { color: theme.color.textMuted, textAlign: 'center', marginTop: theme.space.xxl },

  forbiddenCard: { gap: theme.space.sm, alignItems: 'center' },
  forbiddenTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  forbiddenBody: { fontSize: theme.font.small, color: theme.color.textMuted, textAlign: 'center' },

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
  thumbEmpty: { borderWidth: 1, borderColor: theme.color.border, borderStyle: 'dashed' },
  cardBody: { flex: 1, gap: 2 },
  ref: { fontWeight: '800', fontSize: theme.font.body, color: theme.color.text },
  when: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  notePreview: { fontSize: theme.font.small, color: theme.color.textMuted },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, marginTop: 2 },
  imgCount: { fontSize: theme.font.tiny, color: theme.color.textFaint },
  arrow: { fontSize: 22, color: theme.color.textFaint, fontWeight: '300' },

  // Detail
  detailScroll: { flex: 1, backgroundColor: theme.color.bg },
  detailContent: { padding: theme.space.lg, gap: theme.space.md, paddingBottom: theme.space.xxl },
  backBtn: { alignSelf: 'flex-start' },
  backText: { color: theme.color.accent, fontWeight: '700', fontSize: theme.font.small },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailRef: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text },

  section: { gap: theme.space.sm },
  sectionTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  hint: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  noteText: { fontSize: theme.font.small, color: theme.color.text, lineHeight: 20 },
  rejectedReason: { fontSize: theme.font.small, color: theme.color.danger, fontWeight: '600' },

  imageRow: { gap: theme.space.sm, paddingVertical: theme.space.xs },
  rxImage: { width: 140, height: 190, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt },

  billRow: {
    gap: theme.space.xs,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    backgroundColor: theme.color.surfaceAlt,
  },
  billRowInputs: { flexDirection: 'row', gap: theme.space.sm },
  flex: { flex: 1 },
  qtyCol: { width: 80 },
  billRowFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lineTotal: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  removeItem: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.danger },

  addItemBtn: { paddingVertical: theme.space.sm, alignItems: 'center' },
  addItemText: { color: theme.color.accent, fontWeight: '800', fontSize: theme.font.small },

  autoFeeNote: {
    fontSize: theme.font.small,
    color: theme.color.textMuted,
    fontStyle: 'italic',
    marginTop: theme.space.xs,
  },

  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: theme.space.sm,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  subtotalLabel: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  subtotalValue: { fontSize: theme.font.h3, fontWeight: '900', color: theme.color.accent },

  viewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },

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
});
