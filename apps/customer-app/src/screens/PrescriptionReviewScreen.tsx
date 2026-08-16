import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PrescriptionStatus } from '@passwaala/shared';
import type { PrescriptionView } from '@passwaala/shared';
import { api } from '../api';
import { shadow, theme } from '../theme';
import { Badge, Button, ErrorState, Loading } from '../ui';
import { useLang } from '../i18n/LanguageContext';

/** Poll interval while a prescription is still awaiting the shop's quote. */
const POLL_MS = 15000;

/**
 * PrescriptionReviewScreen — the customer-side status + pay step of the
 * medical-store prescription flow. Loads the prescription (polling while it's
 * still SUBMITTED, plus pull-to-refresh) and renders one of:
 *   • SUBMITTED  → waiting for the pharmacy to build the bill
 *   • QUOTED     → the bill is ready; "Review & pay" opens the linked order in
 *                  the EXISTING order flow (UPI payment via OrderTrackingScreen)
 *   • CONVERTED  → already an order; "View order" opens it
 *   • REJECTED   → shows the pharmacy's rejection reason
 */
export function PrescriptionReviewScreen({
  prescriptionId,
  onBack,
  onOpenOrder,
}: {
  prescriptionId: string;
  onBack: () => void;
  /** Open the linked order in the existing order/payment flow. */
  onOpenOrder: (orderId: string) => void;
}) {
  const { t } = useLang();
  const [rx, setRx] = useState<PrescriptionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.prescription(prescriptionId);
      setRx(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [prescriptionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while still awaiting a quote so the "bill ready" state appears without
  // a manual refresh. Stops once the prescription leaves SUBMITTED.
  const status = rx?.status;
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (status !== PrescriptionStatus.SUBMITTED) return;
    const id = setInterval(() => { void loadRef.current(); }, POLL_MS);
    return () => clearInterval(id);
  }, [status]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  if (loading) return <View style={styles.root}><Header onBack={onBack} title={t.rx.reviewTitle} /><Loading /></View>;
  if (error && !rx) {
    return (
      <View style={styles.root}>
        <Header onBack={onBack} title={t.rx.reviewTitle} />
        <ErrorState message={error} onRetry={load} />
      </View>
    );
  }
  if (!rx) {
    return (
      <View style={styles.root}>
        <Header onBack={onBack} title={t.rx.reviewTitle} />
        <Text style={styles.namePrompt}>{t.rx.notFound}</Text>
      </View>
    );
  }

  const statusMeta = statusBadge(rx.status, t);
  const submittedOn = new Date(rx.createdAt).toLocaleDateString();

  return (
    <View style={styles.root}>
      <Header onBack={onBack} title={t.rx.reviewTitle} subtitle={rx.shopName} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Status card */}
        <View style={styles.section}>
          <View style={styles.statusHead}>
            <Badge label={statusMeta.label} tone={statusMeta.tone} />
            <Text style={styles.submittedOn}>{t.rx.submittedOn(submittedOn)}</Text>
          </View>

          {rx.status === PrescriptionStatus.SUBMITTED ? (
            <>
              <Text style={styles.stateTitle}>{t.rx.waitingTitle}</Text>
              <Text style={styles.stateBody}>{t.rx.waitingBody}</Text>
            </>
          ) : null}

          {rx.status === PrescriptionStatus.QUOTED ? (
            <>
              <Text style={styles.stateTitle}>{t.rx.quotedTitle}</Text>
              <Text style={styles.stateBody}>{t.rx.quotedBody}</Text>
              {rx.orderId ? (
                <Button
                  label={t.rx.reviewAndPay}
                  onPress={() => onOpenOrder(rx.orderId!)}
                  style={styles.actionBtn}
                />
              ) : null}
            </>
          ) : null}

          {rx.status === PrescriptionStatus.CONVERTED ? (
            <>
              <Text style={styles.stateTitle}>{t.rx.convertedTitle}</Text>
              <Text style={styles.stateBody}>{t.rx.convertedBody}</Text>
              {rx.orderId ? (
                <Button
                  label={t.rx.viewOrder}
                  onPress={() => onOpenOrder(rx.orderId!)}
                  style={styles.actionBtn}
                />
              ) : null}
            </>
          ) : null}

          {rx.status === PrescriptionStatus.REJECTED ? (
            <>
              <Text style={styles.stateTitle}>{t.rx.rejectedTitle}</Text>
              <Text style={styles.stateBody}>{rx.rejectionReason || t.rx.rejectedNoReason}</Text>
            </>
          ) : null}
        </View>

        {/* Uploaded photos */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.rx.photosLabel}</Text>
          <View style={styles.thumbGrid}>
            {rx.imageUrls.map((url) => (
              <Pressable key={url} onPress={() => setPreview(url)}>
                <Image source={{ uri: url }} style={styles.thumb} />
              </Pressable>
            ))}
          </View>
        </View>

        {/* Note */}
        {rx.note ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t.rx.noteLabel}</Text>
            <Text style={styles.noteText}>{rx.note}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Fullscreen image preview */}
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable style={styles.previewBackdrop} onPress={() => setPreview(null)}>
          <Pressable style={styles.previewClose} onPress={() => setPreview(null)} hitSlop={10}>
            <Text style={styles.previewCloseText}>✕</Text>
          </Pressable>
          {preview ? (
            <Image source={{ uri: preview }} style={styles.previewImage} resizeMode="contain" />
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function statusBadge(
  status: PrescriptionStatus,
  t: ReturnType<typeof useLang>['t'],
): { label: string; tone: 'neutral' | 'success' | 'danger' | 'accent' } {
  switch (status) {
    case PrescriptionStatus.QUOTED:
      return { label: t.rx.statusQuoted, tone: 'success' };
    case PrescriptionStatus.CONVERTED:
      return { label: t.rx.statusConverted, tone: 'accent' };
    case PrescriptionStatus.REJECTED:
      return { label: t.rx.statusRejected, tone: 'danger' };
    case PrescriptionStatus.SUBMITTED:
    default:
      return { label: t.rx.statusSubmitted, tone: 'neutral' };
  }
}

function Header({ onBack, title, subtitle }: { onBack: () => void; title: string; subtitle?: string }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerBack}>
        <Text style={styles.headerBackText}>←</Text>
      </Pressable>
      <View>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  scroll: { paddingBottom: theme.space.xxl, gap: theme.space.md, paddingTop: theme.space.md },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    backgroundColor: theme.color.bg,
    ...shadow.sm,
  },
  headerBack: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBackText: { fontSize: 20, fontWeight: theme.weight.bold, color: theme.color.text },
  headerTitle: { fontSize: theme.font.h2, fontWeight: theme.weight.bold, color: theme.color.text },
  headerSubtitle: { fontSize: theme.font.small, color: theme.color.textMuted },

  section: {
    backgroundColor: theme.color.card,
    marginHorizontal: theme.space.lg,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    gap: theme.space.sm,
    ...shadow.sm,
  },
  sectionTitle: { fontSize: theme.font.h3, fontWeight: theme.weight.bold, color: theme.color.text, marginBottom: 2 },

  statusHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.sm },
  submittedOn: { fontSize: theme.font.tiny, color: theme.color.textFaint },
  stateTitle: { fontSize: theme.font.h3, fontWeight: theme.weight.bold, color: theme.color.text, marginTop: theme.space.sm },
  stateBody: { fontSize: theme.font.body, color: theme.color.textMuted, lineHeight: 21 },
  actionBtn: { marginTop: theme.space.sm },

  thumbGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginTop: theme.space.xs },
  thumb: { width: 84, height: 84, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceAlt },

  noteText: { fontSize: theme.font.body, color: theme.color.text, lineHeight: 21 },
  namePrompt: { fontSize: theme.font.small, color: theme.color.textMuted, textAlign: 'center', marginTop: theme.space.xl },

  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space.lg,
  },
  previewImage: { width: '100%', height: '70%' },
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
