import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { buildUpiDeepLink } from '@passwaala/shared';
import { api } from '../api';
import { formatRupees, theme } from '../theme';
import { Badge, Banner, Button, Card, ErrorText, Field, Screen } from '../ui';
import { UpiQr } from '../components/UpiQr';
import { DisputeModal } from '../components/DisputeModal';
import { useLang } from '../i18n/LanguageContext';
import { OtpBoxes } from '../ui';
import type { RiderJob } from '../types';

/** Poll interval for available jobs + active work while online. */
const POLL_MS = 20000;

/**
 * Build a maps directions URL to a lat/lng (web + native both handle the
 * https google maps URL). Returns null if coords are missing/invalid.
 */
function mapsUrl(lat?: number | null, lng?: number | null): string | null {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${a},${b}`;
}

/** The cash a COD order's rider must collect (final billed total). */
function collectPaise(job: RiderJob): number {
  return job.adjustedTotalPaise ?? job.originalTotalPaise;
}
const isCod = (job: RiderJob) => job.paymentMethod === 'COD';

/**
 * The shop's UPI collect link for a job (prefilled VPA + exact amount), or null
 * when the shop has no VPA. The rider shows this as a QR for the customer to
 * scan and pay the shop directly.
 */
function upiCollectLink(job: RiderJob): string | null {
  if (!job.shop?.upiVpa) return null;
  return buildUpiDeepLink(
    job.shop.upiVpa,
    job.shop.name ?? 'Shop',
    collectPaise(job),
    job.shortId ?? `OR${job.id.replace(/-/g,'').slice(0,8).toUpperCase()}`,
  );
}

/**
 * JobsScreen — the rider's work hub. Shows TWO sections while online:
 *
 *  1. "Your active order" — orders the rider has claimed. RIDER_ASSIGNED gets a
 *     "Navigate to shop" button + a "Confirm pickup" OTP box (the shop's rider
 *     pickup code); once picked up the order is OUT_FOR_DELIVERY and gets the
 *     "Mark delivered" + customer handoff-OTP box. Orders stay here until
 *     DELIVERED (then they move to the Deliveries history tab).
 *  2. "Available jobs" — unclaimed READY platform-rider orders, each with
 *     "Accept delivery".
 *
 * Auto-polls every ~8s while online. Offline/empty states are handled.
 */
export function JobsScreen({ online }: { online: boolean }) {
  const { t } = useLang();
  const [jobs, setJobs] = useState<RiderJob[]>([]);
  const [active, setActive] = useState<RiderJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Track mount so an in-flight poll doesn't setState after unmount.
  const alive = useRef(true);

  // Per-order OTP entry — shared by the pickup (RIDER_ASSIGNED) and delivery
  // (OUT_FOR_DELIVERY) boxes; only one is open at a time.
  const [openId, setOpenId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  // Which order's UPI QR is currently revealed (tapped "Show QR").
  const [showQrId, setShowQrId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  // For a COD delivery, how the customer paid: 'cash' (rider owes dues) or 'qr'
  // (customer scanned the shop's UPI → paid the shop directly, no dues).
  const [codMethod, setCodMethod] = useState<'cash' | 'qr'>('cash');
  // Once the rider confirms the customer finished the QR/UPI payment, hide the
  // QR (there's no server signal — the payment went straight to the shop).
  const [qrPaid, setQrPaid] = useState(false);
  // Ticks every second so the offer countdown re-renders live.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secondsLeftFor = (job: RiderJob): number | null => {
    if (!job.offerExpiresAt) return null;
    const ms = new Date(job.offerExpiresAt).getTime() - nowMs;
    return ms > 0 ? Math.ceil(ms / 1000) : 0;
  };

  const load = useCallback(async () => {
    if (!online) {
      setJobs([]);
      setActive([]);
      setLoading(false);
      return;
    }
    try {
      // Available jobs + the rider's active (claimed, in-hand) deliveries. The
      // deliveries endpoint returns active orders only, so no client filter.
      const [available, mine] = await Promise.all([
        api.riderJobs() as Promise<RiderJob[]>,
        api.riderDeliveries() as Promise<RiderJob[]>,
      ]);
      if (!alive.current) return;
      setJobs(available);
      setActive(mine);
      setError(null);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [online]);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  // Auto-poll while online so new jobs + status changes surface without a
  // manual refresh.
  useEffect(() => {
    if (!online) return;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [online, load]);

  // While the rider is holding an active order, push GPS every ~10s so the
  // customer's tracking map can follow them toward the drop. Guarded on
  // geolocation availability (web + native safe; no-op otherwise).
  const hasActive = active.length > 0;
  useEffect(() => {
    if (!hasActive) return;
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) return;
    const ping = () => {
      geo.getCurrentPosition(
        (pos) => { void api.riderUpdateLocation(pos.coords.latitude, pos.coords.longitude).catch(() => undefined); },
        () => undefined,
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 },
      );
    };
    ping();
    const id = setInterval(ping, 30000);
    return () => clearInterval(id);
  }, [hasActive]);

  function openOtp(orderId: string) {
    setOpenId(orderId);
    setOtp('');
    setOtpError(null);
    setCodMethod('cash');
    setQrPaid(false);
  }

  async function accept(orderId: string) {
    setAcceptingId(orderId);
    setError(null);
    try {
      await api.riderAccept(orderId);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAcceptingId(null);
    }
  }

  async function decline(orderId: string) {
    setAcceptingId(orderId);
    setError(null);
    try {
      await api.riderDeclineJob(orderId);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAcceptingId(null);
    }
  }

  /** Confirm pickup at the shop with the shop's rider pickup OTP. */
  async function confirmPickup(orderId: string, codeOverride?: string) {
    const code = (codeOverride ?? otp).trim();
    if (code.length !== 4) {
      setOtpError(t.jobs.enterPickupOtp);
      return;
    }
    setBusyId(orderId);
    setOtpError(null);
    try {
      await api.riderConfirmPickup(orderId, code);
      setOpenId(null);
      setOtp('');
      await load();
    } catch (e) {
      setOtpError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  /** Rider tells the shop the customer paid this COD order by UPI/QR. */
  async function claimUpiPaid(orderId: string) {
    setBusyId(orderId);
    setOtpError(null);
    try {
      await api.riderClaimUpiPaid(orderId);
      await load();
    } catch (e) {
      setOtpError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  /** Complete the delivery with the customer's handoff OTP. */
  async function completeDelivery(orderId: string, codeOverride?: string) {
    const code = (codeOverride ?? otp).trim();
    if (code.length !== 4) {
      setOtpError(t.jobs.enterHandoffOtp);
      return;
    }
    setBusyId(orderId);
    setOtpError(null);
    try {
      await api.riderComplete(orderId, code, codMethod === 'qr');
      setOpenId(null);
      setOtp('');
      await load();
    } catch (e) {
      setOtpError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function navigateToShop(job: RiderJob) {
    const url = mapsUrl(job.shop?.latitude, job.shop?.longitude);
    if (url) void Linking.openURL(url);
  }

  function navigateToCustomer(job: RiderJob) {
    const url = mapsUrl(job.address?.latitude, job.address?.longitude);
    if (url) void Linking.openURL(url);
  }

  if (!online) {
    return (
      <Screen>
        <Banner
          tone="info"
          title={t.jobs.offlineTitle}
          message={t.jobs.offlineMessage}
        />
      </Screen>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.color.accent} size="large" />
      </View>
    );
  }

  const hasShopCoords = (job: RiderJob) => mapsUrl(job.shop?.latitude, job.shop?.longitude) !== null;
  const hasDropCoords = (job: RiderJob) => mapsUrl(job.address?.latitude, job.address?.longitude) !== null;

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={theme.color.accent}
        />
      }
    >
      {error ? <ErrorText>{error}</ErrorText> : null}

      {/* Section 1: the rider's active order(s) — pickup → deliver. */}
      {active.length > 0 ? (
        <>
          <Text style={styles.heading}>{active.length > 1 ? t.jobs.activeOrders : t.jobs.activeOrder}</Text>
          {active.map((d) => {
            const assigned = d.status === 'RIDER_ASSIGNED';
            const open = openId === d.id;
            return (
              <ActiveCard key={d.id} order={d} assigned={assigned} showQr={showQrId === d.id} onToggleQr={() => setShowQrId(prev => prev === d.id ? null : d.id)}>
                {assigned ? (
                  <>
                    {hasShopCoords(d) ? (
                      <Button
                        label={t.jobs.navigateToShop}
                        variant="outline"
                        onPress={() => navigateToShop(d)}
                        style={{ marginTop: theme.space.md }}
                      />
                    ) : null}
                    {open ? (
                      <View style={styles.otpBox}>
                        <Text style={styles.otpLabel}>{t.jobs.shopPickupOtp}</Text>
                        <OtpBoxes value={otp} onChange={setOtp} onComplete={(code) => confirmPickup(d.id, code)} length={4} />
                        <Text style={styles.otpHint}>{t.jobs.pickupHint}</Text>
                        {otpError ? <ErrorText>{otpError}</ErrorText> : null}
                        <View style={styles.otpActions}>
                          <Button
                            label={t.jobs.confirmPickup}
                            onPress={() => confirmPickup(d.id)}
                            busy={busyId === d.id}
                            style={styles.flex}
                          />
                          <Button
                            label={t.common.cancel}
                            variant="ghost"
                            onPress={() => { setOpenId(null); setOtpError(null); }}
                            style={styles.flex}
                          />
                        </View>
                      </View>
                    ) : (
                      <Button
                        label={t.jobs.confirmPickup}
                        onPress={() => openOtp(d.id)}
                        style={{ marginTop: theme.space.sm }}
                      />
                    )}
                  </>
                ) : open ? (
                  <View style={styles.otpBox}>
                    {/* COD: rider picks how the customer paid. Cash → rider owes
                        dues; QR → customer scans the shop's UPI, pays the shop
                        directly (no dues). */}
                    {isCod(d) ? (
                      <>
                        <View style={styles.payToggle}>
                          <Button
                            label={t.jobs.cash}
                            variant={codMethod === 'cash' ? 'accent' : 'outline'}
                            small
                            onPress={() => { setCodMethod('cash'); setQrPaid(false); }}
                            style={styles.flex}
                          />
                          <Button
                            label={t.jobs.qrUpi}
                            variant={codMethod === 'qr' ? 'accent' : 'outline'}
                            small
                            onPress={() => setCodMethod('qr')}
                            style={styles.flex}
                          />
                        </View>
                        {codMethod === 'cash' ? (
                          <Text style={styles.payHint}>
                            {t.jobs.collectCash(formatRupees(collectPaise(d)))}
                          </Text>
                        ) : !upiCollectLink(d) ? (
                          <Text style={styles.payHint}>
                            {t.jobs.noUpiSet}
                          </Text>
                        ) : d.paymentConfirmed ? (
                          <Text style={styles.payPaid}>
                            {t.jobs.shopConfirmedPayment(formatRupees(collectPaise(d)))}
                          </Text>
                        ) : d.codUpiClaimedAt ? (
                          <Text style={styles.payWaiting}>
                            {t.jobs.waitingShopConfirm(d.shop?.name ?? t.jobs.theShop, formatRupees(collectPaise(d)))}
                          </Text>
                        ) : (
                          <View style={styles.qrWrap}>
                            <Text style={styles.payHint}>
                              {t.jobs.askCustomerScan(formatRupees(collectPaise(d)), d.shop?.name ?? t.jobs.theShop)}
                            </Text>
                            <View style={styles.qrFrame}>
                              <UpiQr link={upiCollectLink(d) as string} size={180} />
                            </View>
                            <Button
                              label={t.jobs.customerPaidNotify}
                              variant="outline"
                              small
                              busy={busyId === d.id}
                              onPress={() => claimUpiPaid(d.id)}
                            />
                          </View>
                        )}
                      </>
                    ) : null}
                    <Text style={styles.otpLabel}>{t.jobs.handoffOtp}</Text>
                    <OtpBoxes value={otp} onChange={setOtp} onComplete={(code) => completeDelivery(d.id, code)} length={4} />
                    <Text style={styles.otpHint}>{t.jobs.handoffHint}</Text>
                    {otpError ? <ErrorText>{otpError}</ErrorText> : null}
                    <View style={styles.otpActions}>
                      <Button
                        label={t.jobs.confirmDelivery}
                        onPress={() => completeDelivery(d.id)}
                        busy={busyId === d.id}
                        disabled={isCod(d) && codMethod === 'qr' && !d.paymentConfirmed}
                        style={styles.flex}
                      />
                      <Button
                        label={t.common.cancel}
                        variant="ghost"
                        onPress={() => { setOpenId(null); setOtpError(null); }}
                        style={styles.flex}
                      />
                    </View>
                  </View>
                ) : (
                  <>
                    {hasDropCoords(d) ? (
                      <Button
                        label={t.jobs.navigateToCustomer}
                        variant="outline"
                        onPress={() => navigateToCustomer(d)}
                        style={{ marginTop: theme.space.md }}
                      />
                    ) : null}
                    <Button
                      label={t.jobs.markDelivered}
                      onPress={() => openOtp(d.id)}
                      style={{ marginTop: theme.space.sm }}
                    />
                  </>
                )}
              </ActiveCard>
            );
          })}
        </>
      ) : null}

      {/* Section 2: jobs offered to this rider (or the open board once dispatch
          has exhausted all rings). An offer shows a live countdown + Decline. */}
      <Text style={[styles.heading, active.length > 0 ? { marginTop: theme.space.lg } : null]}>
        {jobs.some((j) => j.offerExpiresAt) ? t.jobs.newDeliveryOffer : t.jobs.availableJobs}
      </Text>
      {jobs.length === 0 ? (
        <Banner
          tone="info"
          title={t.jobs.noOffersTitle}
          message={t.jobs.noOffersMessage}
        />
      ) : (
        jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            accepting={acceptingId === job.id}
            disabled={acceptingId !== null}
            secondsLeft={secondsLeftFor(job)}
            onAccept={() => accept(job.id)}
            onDecline={() => decline(job.id)}
          />
        ))
      )}
    </Screen>
  );
}

/** A card for one of the rider's active orders (pickup or delivery leg). */
function ActiveCard({
  order,
  assigned,
  showQr,
  onToggleQr,
  children,
}: {
  order: RiderJob;
  assigned: boolean;
  showQr: boolean;
  onToggleQr: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useLang();
  const itemCount = order.items?.reduce((sum, i) => sum + (i.qty ?? 0), 0) ?? 0;
  const pickup = [order.shop?.addressLine, order.shop?.city].filter(Boolean).join(', ');
  const drop = [order.address?.line, order.address?.landmark].filter(Boolean).join(', ');
  return (
    <Card>
      <View style={styles.cardHeader}>
        <View style={styles.headerInfo}>
          <Text style={styles.shopName} numberOfLines={1}>{order.shop?.name ?? t.common.shop}</Text>
          <Text style={styles.orderNo}>{order.shortId ?? `OR${order.id.replace(/-/g,"").slice(0,8).toUpperCase()}`}</Text>
        </View>
        <Badge
          label={assigned ? t.jobs.goToShop : t.jobs.outForDelivery}
          tone={assigned ? 'accent' : 'warning'}
        />
      </View>

      <View style={styles.leg}>
        <Text style={styles.legLabel}>{t.jobs.pickupLabel}</Text>
        <Text style={styles.legText}>{pickup || t.jobs.pickupUnavailable}</Text>
      </View>
      <View style={styles.leg}>
        <Text style={styles.legLabel}>{t.jobs.dropLabel}</Text>
        <Text style={styles.legText}>{drop || t.jobs.dropUnavailable}</Text>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>{t.jobs.itemCount(itemCount)}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.meta}>{t.jobs.fee(formatRupees(order.deliveryFeePaise))}</Text>
      </View>

      {/* Payment mode: COD → collect cash (or offer QR as alternative); UPI → already paid. */}
      {isCod(order) ? (
        <View style={[styles.payBox, styles.payBoxCod]}>
          <Text style={styles.payCodText}>{t.jobs.codCollect(formatRupees(collectPaise(order)))}</Text>
        </View>
      ) : (
        <View style={[styles.payBox, styles.payBoxUpi]}>
          <Text style={styles.payUpiText}>
            {t.jobs.upiPaysShop}
          </Text>
        </View>
      )}

      {children}
      {order.createdAt ? (
        <DisputeModal orderId={order.id} orderCreatedAt={order.createdAt} senderRole="RIDER" inline={true} />
      ) : null}
    </Card>
  );
}

function JobCard({
  job,
  accepting,
  disabled,
  secondsLeft,
  onAccept,
  onDecline,
}: {
  job: RiderJob;
  accepting: boolean;
  disabled: boolean;
  secondsLeft: number | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { t } = useLang();
  const itemCount = job.items?.reduce((sum, i) => sum + (i.qty ?? 0), 0) ?? 0;
  const pickup = [job.shop?.addressLine, job.shop?.city].filter(Boolean).join(', ');
  const drop = [job.address?.line, job.address?.landmark].filter(Boolean).join(', ');
  const isOffer = secondsLeft !== null; // a timed offer vs an open-board job
  return (
    <Card>
      {isOffer ? (
        <View style={styles.countdownRow}>
          <Text style={styles.countdownText}>{t.jobs.respondIn(secondsLeft as number)}</Text>
        </View>
      ) : null}
      <View style={styles.cardHeader}>
        <View style={styles.headerInfo}>
          <Text style={styles.shopName} numberOfLines={1}>{job.shop?.name ?? t.common.shop}</Text>
          <Text style={styles.orderNo}>{job.shortId ?? `OR${job.id.replace(/-/g,"").slice(0,8).toUpperCase()}`}</Text>
        </View>
        <Badge label={formatRupees(job.deliveryFeePaise)} tone="accent" />
      </View>

      <View style={styles.leg}>
        <Text style={styles.legLabel}>{t.jobs.pickupLabel}</Text>
        <Text style={styles.legText}>{pickup || t.jobs.pickupUnavailable}</Text>
      </View>
      <View style={styles.leg}>
        <Text style={styles.legLabel}>{t.jobs.dropLabel}</Text>
        <Text style={styles.legText}>{drop || t.jobs.dropUnavailable}</Text>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>{t.jobs.itemCount(itemCount)}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.meta}>{t.jobs.order(formatRupees(job.originalTotalPaise))}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={[styles.meta, styles.payTag]}>{isCod(job) ? t.jobs.cod(formatRupees(collectPaise(job))) : t.jobs.upi}</Text>
      </View>

      <View style={styles.offerActions}>
        <Button
          label={t.jobs.acceptDelivery}
          onPress={onAccept}
          busy={accepting}
          disabled={disabled && !accepting}
          style={styles.flex}
        />
        {isOffer ? (
          <Button
            label={t.jobs.decline}
            variant="ghost"
            onPress={onDecline}
            disabled={disabled}
            style={styles.flex}
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.bg },
  heading: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.sm, marginBottom: theme.space.md },
  headerInfo: { flex: 1, gap: 1 },
  orderNo: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textFaint, letterSpacing: 0.5 },
  shopName: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  leg: { marginBottom: theme.space.sm },
  legLabel: { fontSize: theme.font.tiny, fontWeight: '800', color: theme.color.textFaint, letterSpacing: 0.5 },
  legText: { fontSize: theme.font.body, color: theme.color.text, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, marginTop: theme.space.xs },
  meta: { fontSize: theme.font.small, color: theme.color.textMuted, fontWeight: '600' },
  metaDot: { color: theme.color.textFaint },
  payTag: { fontWeight: '800', color: theme.color.text },
  payBox: { borderRadius: theme.radius.md, paddingVertical: theme.space.sm, paddingHorizontal: theme.space.md, marginTop: theme.space.xs },
  payBoxCod: { backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#F59E0B' },
  payBoxUpi: { backgroundColor: theme.color.surfaceAlt, borderWidth: 1, borderColor: theme.color.border },
  payCodText: { fontSize: theme.font.small, fontWeight: '800', color: '#92400E' },
  payUpiText: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  payToggle: { flexDirection: 'row', gap: theme.space.sm },
  payHint: { fontSize: theme.font.small, color: theme.color.textMuted, textAlign: 'center' },
  payPaid: { fontSize: theme.font.small, color: theme.color.success, fontWeight: '800', textAlign: 'center' },
  payWaiting: { fontSize: theme.font.small, color: '#B45309', fontWeight: '700', textAlign: 'center' },
  qrWrap: { alignItems: 'center', marginTop: theme.space.md, gap: theme.space.sm },
  qrFrame: {
    backgroundColor: '#FFFFFF',
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  qrHint: { fontSize: theme.font.tiny, color: theme.color.textMuted, textAlign: 'center' },
  countdownRow: { alignSelf: 'flex-start', backgroundColor: theme.color.accent, borderRadius: theme.radius.pill, paddingHorizontal: theme.space.md, paddingVertical: 4, marginBottom: theme.space.sm },
  countdownText: { color: theme.color.white, fontWeight: '800', fontSize: theme.font.small },
  offerActions: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.md },
  otpBox: { marginTop: theme.space.md, gap: theme.space.sm },
  otpLabel: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text, textAlign: 'center' },
  otpHint: { fontSize: theme.font.tiny, color: theme.color.textMuted, textAlign: 'center' },
  otpActions: { flexDirection: 'row', gap: theme.space.sm },
  flex: { flex: 1 },
});
