import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { buildUpiDeepLink } from '@passwaala/shared';
import { api } from '../api';
import { onSocket } from '../socket';
import { formatRupees, theme } from '../theme';
import { Badge, Banner, Button, Card, ErrorText, Field, Screen } from '../ui';
import { UpiQr } from '../components/UpiQr';
import { DisputeModal } from '../components/DisputeModal';
import { useLang } from '../i18n/LanguageContext';
import { OtpBoxes } from '../ui';
import type { RiderJob, BulkRiderJob } from '../types';

/** Fallback poll for jobs while online — socket 'job.offered' is primary (ms). */
const POLL_MS = 60000;

function mapsUrl(lat?: number | null, lng?: number | null): string | null {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${a},${b}`;
}

function collectPaise(job: RiderJob): number {
  const base = job.adjustedTotalPaise ?? job.originalTotalPaise;
  const due = (job.extraDeliveryDuePaise ?? 0) + (job.addedItemsDuePaise ?? 0);
  return base + due;
}
const isCod = (job: RiderJob) => job.paymentMethod === 'COD';
const isBulkCod = (job: BulkRiderJob) => job.paymentMethod === 'COD';

function upiCollectLink(job: RiderJob): string | null {
  if (!job.shop?.upiVpa) return null;
  return buildUpiDeepLink(
    job.shop.upiVpa,
    job.shop.name ?? 'Shop',
    collectPaise(job),
    job.shortId ?? `OR${job.id.replace(/-/g,'').slice(0,8).toUpperCase()}`,
  );
}

export function JobsScreen({ online }: { online: boolean }) {
  const { t } = useLang();
  const [jobs, setJobs] = useState<RiderJob[]>([]);
  const [bulkJobs, setBulkJobs] = useState<BulkRiderJob[]>([]);
  const [active, setActive] = useState<RiderJob[]>([]);
  const [activeBulk, setActiveBulk] = useState<BulkRiderJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const [openId, setOpenId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [showQrId, setShowQrId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [codMethod, setCodMethod] = useState<'cash' | 'qr'>('cash');
  const [qrPaid, setQrPaid] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secondsLeftFor = (job: RiderJob | BulkRiderJob): number | null => {
    if (!job.offerExpiresAt) return null;
    const ms = new Date(job.offerExpiresAt).getTime() - nowMs;
    return ms > 0 ? Math.ceil(ms / 1000) : 0;
  };

  const load = useCallback(async () => {
    if (!online) {
      setJobs([]); setBulkJobs([]); setActive([]); setActiveBulk([]);
      setLoading(false);
      return;
    }
    try {
      const [available, mine] = await Promise.all([
        api.riderJobs() as unknown as Promise<{ orders: RiderJob[]; bulkOrders: BulkRiderJob[] }>,
        api.riderDeliveries() as unknown as Promise<{ orders: RiderJob[]; bulkOrders: BulkRiderJob[] }>,
      ]);
      if (!alive.current) return;
      setJobs(available.orders ?? []);
      setBulkJobs(available.bulkOrders ?? []);
      setActive(mine.orders ?? []);
      setActiveBulk(mine.bulkOrders ?? []);
      setError(null);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) { setLoading(false); setRefreshing(false); }
    }
  }, [online]);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    load();
    return () => { alive.current = false; };
  }, [load]);

  useEffect(() => {
    if (!online) return;
    const id = setInterval(load, POLL_MS);
    const off = onSocket('job.offered', () => { void load(); });
    return () => { clearInterval(id); off(); };
  }, [online, load]);

  const hasActive = active.length > 0 || activeBulk.length > 0;
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

  function openOtp(id: string) {
    setOpenId(id); setOtp(''); setOtpError(null); setCodMethod('cash'); setQrPaid(false);
  }

  async function accept(orderId: string) {
    setAcceptingId(orderId); setError(null);
    const prevJobs = jobs;
    setJobs((list) => list.filter((j) => j.id !== orderId));
    try { await api.riderAccept(orderId); await load(); }
    catch (e) { setJobs(prevJobs); setError((e as Error).message); }
    finally { setAcceptingId(null); }
  }

  async function acceptBulk(bulkOrderId: string) {
    setAcceptingId(bulkOrderId); setError(null);
    const prevBulk = bulkJobs;
    setBulkJobs((list) => list.filter((j) => j.id !== bulkOrderId));
    try { await api.riderAcceptBulk(bulkOrderId); await load(); }
    catch (e) { setBulkJobs(prevBulk); setError((e as Error).message); }
    finally { setAcceptingId(null); }
  }

  async function decline(orderId: string) {
    setAcceptingId(orderId); setError(null);
    const prevJobs = jobs;
    setJobs((list) => list.filter((j) => j.id !== orderId));
    try { await api.riderDeclineJob(orderId); await load(); }
    catch (e) { setJobs(prevJobs); setError((e as Error).message); }
    finally { setAcceptingId(null); }
  }

  async function declineBulk(bulkOrderId: string) {
    setAcceptingId(bulkOrderId); setError(null);
    const prevBulk = bulkJobs;
    setBulkJobs((list) => list.filter((j) => j.id !== bulkOrderId));
    try { await api.riderDeclineBulk(bulkOrderId); await load(); }
    catch (e) { setBulkJobs(prevBulk); setError((e as Error).message); }
    finally { setAcceptingId(null); }
  }

  async function confirmPickup(orderId: string, codeOverride?: string) {
    const code = (codeOverride ?? otp).trim();
    if (code.length !== 4) { setOtpError(t.jobs.enterPickupOtp); return; }
    setBusyId(orderId); setOtpError(null);
    try { await api.riderConfirmPickup(orderId, code); setOpenId(null); setOtp(''); await load(); }
    catch (e) { setOtpError((e as Error).message); }
    finally { setBusyId(null); }
  }

  async function confirmBulkPickup(subOrderId: string, codeOverride?: string) {
    const code = (codeOverride ?? otp).trim();
    if (code.length !== 4) { setOtpError(t.jobs.enterPickupOtp); return; }
    setBusyId(subOrderId); setOtpError(null);
    try { await api.riderConfirmBulkPickup(subOrderId, code); setOpenId(null); setOtp(''); await load(); }
    catch (e) { setOtpError((e as Error).message); }
    finally { setBusyId(null); }
  }

  async function claimUpiPaid(orderId: string) {
    setBusyId(orderId); setOtpError(null);
    try { await api.riderClaimUpiPaid(orderId); await load(); }
    catch (e) { setOtpError((e as Error).message); }
    finally { setBusyId(null); }
  }

  async function claimBulkSubUpiPaid(subOrderId: string) {
    setBusyId(subOrderId); setOtpError(null);
    try { await api.riderClaimBulkSubUpi(subOrderId); await load(); }
    catch (e) { setOtpError((e as Error).message); }
    finally { setBusyId(null); }
  }

  async function completeDelivery(orderId: string, codeOverride?: string) {
    const code = (codeOverride ?? otp).trim();
    if (code.length !== 4) { setOtpError(t.jobs.enterHandoffOtp); return; }
    setBusyId(orderId); setOtpError(null);
    try { await api.riderComplete(orderId, code, codMethod === 'qr'); setOpenId(null); setOtp(''); await load(); }
    catch (e) { setOtpError((e as Error).message); }
    finally { setBusyId(null); }
  }

  async function completeBulkDelivery(bulkOrderId: string, codeOverride?: string) {
    const code = (codeOverride ?? otp).trim();
    if (code.length !== 4) { setOtpError(t.jobs.enterHandoffOtp); return; }
    setBusyId(bulkOrderId); setOtpError(null);
    try { await api.riderCompleteBulk(bulkOrderId, code, codMethod === 'qr'); setOpenId(null); setOtp(''); await load(); }
    catch (e) { setOtpError((e as Error).message); }
    finally { setBusyId(null); }
  }

  function navigateToShop(job: RiderJob) {
    const url = mapsUrl(job.shop?.latitude, job.shop?.longitude);
    if (url) void Linking.openURL(url);
  }
  function navigateToCustomer(job: RiderJob) {
    const url = mapsUrl(job.address?.latitude, job.address?.longitude);
    if (url) void Linking.openURL(url);
  }
  function navigateToBulkDrop(job: BulkRiderJob) {
    const url = mapsUrl(job.address?.latitude, job.address?.longitude);
    if (url) void Linking.openURL(url);
  }
  function navigateToBulkShop(sub: BulkRiderJob['orders'][0]) {
    const url = mapsUrl(sub.shop?.latitude, sub.shop?.longitude);
    if (url) void Linking.openURL(url);
  }

  if (!online) {
    return (
      <Screen>
        <Banner tone="info" title={t.jobs.offlineTitle} message={t.jobs.offlineMessage} />
      </Screen>
    );
  }
  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={theme.color.accent} size="large" /></View>;
  }

  const hasShopCoords = (job: RiderJob) => mapsUrl(job.shop?.latitude, job.shop?.longitude) !== null;
  const hasDropCoords = (job: RiderJob) => mapsUrl(job.address?.latitude, job.address?.longitude) !== null;

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.accent} />
      }
    >
      {error ? <ErrorText>{error}</ErrorText> : null}

      {/* Active single orders */}
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
                      <Button label={t.jobs.navigateToShop} variant="outline" onPress={() => navigateToShop(d)} style={{ marginTop: theme.space.md }} />
                    ) : null}
                    {open ? (
                      <View style={styles.otpBox}>
                        <Text style={styles.otpLabel}>{t.jobs.shopPickupOtp}</Text>
                        <OtpBoxes value={otp} onChange={setOtp} onComplete={(code) => confirmPickup(d.id, code)} length={4} />
                        <Text style={styles.otpHint}>{t.jobs.pickupHint}</Text>
                        {otpError ? <ErrorText>{otpError}</ErrorText> : null}
                        <View style={styles.otpActions}>
                          <Button label={t.jobs.confirmPickup} onPress={() => confirmPickup(d.id)} busy={busyId === d.id} style={styles.flex} />
                          <Button label={t.common.cancel} variant="ghost" onPress={() => { setOpenId(null); setOtpError(null); }} style={styles.flex} />
                        </View>
                      </View>
                    ) : (
                      <Button label={t.jobs.confirmPickup} onPress={() => openOtp(d.id)} style={{ marginTop: theme.space.sm }} />
                    )}
                  </>
                ) : open ? (
                  <View style={styles.otpBox}>
                    {isCod(d) ? (
                      <>
                        <View style={styles.payToggle}>
                          <Button label={t.jobs.cash} variant={codMethod === 'cash' ? 'accent' : 'outline'} small onPress={() => { setCodMethod('cash'); setQrPaid(false); }} style={styles.flex} />
                          <Button label={t.jobs.qrUpi} variant={codMethod === 'qr' ? 'accent' : 'outline'} small onPress={() => setCodMethod('qr')} style={styles.flex} />
                        </View>
                        {codMethod === 'cash' ? (
                          <Text style={styles.payHint}>{t.jobs.collectCash(formatRupees(collectPaise(d)))}</Text>
                        ) : !upiCollectLink(d) ? (
                          <Text style={styles.payHint}>{t.jobs.noUpiSet}</Text>
                        ) : d.paymentConfirmed ? (
                          <Text style={styles.payPaid}>{t.jobs.shopConfirmedPayment(formatRupees(collectPaise(d)))}</Text>
                        ) : d.codUpiClaimedAt ? (
                          <Text style={styles.payWaiting}>{t.jobs.waitingShopConfirm(d.shop?.name ?? t.jobs.theShop, formatRupees(collectPaise(d)))}</Text>
                        ) : (
                          <View style={styles.qrWrap}>
                            <Text style={styles.payHint}>{t.jobs.askCustomerScan(formatRupees(collectPaise(d)), d.shop?.name ?? t.jobs.theShop)}</Text>
                            <View style={styles.qrFrame}><UpiQr link={upiCollectLink(d) as string} size={180} /></View>
                            <Button label={t.jobs.customerPaidNotify} variant="outline" small busy={busyId === d.id} onPress={() => claimUpiPaid(d.id)} />
                          </View>
                        )}
                      </>
                    ) : null}
                    {/* UPI order with added-items / delivery-fee due at door */}
                    {!isCod(d) && ((d.extraDeliveryDuePaise ?? 0) + (d.addedItemsDuePaise ?? 0)) > 0 ? (
                      <Text style={styles.payHint}>
                        Collect {formatRupees((d.extraDeliveryDuePaise ?? 0) + (d.addedItemsDuePaise ?? 0))} at door (extra items/fee added after payment)
                      </Text>
                    ) : null}
                    <Text style={styles.otpLabel}>{t.jobs.handoffOtp}</Text>
                    <OtpBoxes value={otp} onChange={setOtp} onComplete={(code) => completeDelivery(d.id, code)} length={4} />
                    <Text style={styles.otpHint}>{t.jobs.handoffHint}</Text>
                    {otpError ? <ErrorText>{otpError}</ErrorText> : null}
                    <View style={styles.otpActions}>
                      <Button label={t.jobs.confirmDelivery} onPress={() => completeDelivery(d.id)} busy={busyId === d.id} disabled={isCod(d) && codMethod === 'qr' && !d.paymentConfirmed} style={styles.flex} />
                      <Button label={t.common.cancel} variant="ghost" onPress={() => { setOpenId(null); setOtpError(null); }} style={styles.flex} />
                    </View>
                  </View>
                ) : (
                  <>
                    {hasDropCoords(d) ? (
                      <Button label={t.jobs.navigateToCustomer} variant="outline" onPress={() => navigateToCustomer(d)} style={{ marginTop: theme.space.md }} />
                    ) : null}
                    <Button label={t.jobs.markDelivered} onPress={() => openOtp(d.id)} style={{ marginTop: theme.space.sm }} />
                  </>
                )}
              </ActiveCard>
            );
          })}
        </>
      ) : null}

      {/* Active bulk orders */}
      {activeBulk.map((bulk) => {
        const seq: string[] = bulk.pickupSequenceJson ? JSON.parse(bulk.pickupSequenceJson) : bulk.orders.map((o) => o.id);
        const currentSubOrderId = seq.find((id) => {
          const sub = bulk.orders.find((o) => o.id === id);
          return sub && sub.status === 'RIDER_ASSIGNED';
        }) ?? null;
        const currentSub = bulk.orders.find((o) => o.id === currentSubOrderId) ?? null;
        const allPickedUp = bulk.orders.every((o) => o.status === 'OUT_FOR_DELIVERY');
        const open = openId === (currentSubOrderId ?? bulk.id);

        return (
          <Card key={bulk.id}>
            {/* Header */}
            <View style={styles.cardHeader}>
              <View style={styles.headerInfo}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={styles.bulkBadge}><Text style={styles.bulkBadgeText}>BULK</Text></View>
                  <Text style={styles.shopName}>{bulk.shortId ?? `BLK${bulk.id.replace(/-/g,'').slice(0,8).toUpperCase()}`}</Text>
                </View>
                <Text style={styles.orderNo}>{bulk.orders.length} stops · {isBulkCod(bulk) ? 'COD' : 'UPI'}</Text>
              </View>
              <Badge label={allPickedUp ? 'OUT FOR DELIVERY' : 'PICKING UP'} tone={allPickedUp ? 'warning' : 'accent'} />
            </View>

            {/* Step progress */}
            <View style={styles.stepsRow}>
              {seq.map((subId, idx) => {
                const sub = bulk.orders.find((o) => o.id === subId);
                const done = sub?.status === 'OUT_FOR_DELIVERY';
                const current = sub?.status === 'RIDER_ASSIGNED';
                return (
                  <View key={subId} style={styles.stepItem}>
                    <View style={[styles.stepDot, done && styles.stepDotDone, current && styles.stepDotCurrent]} />
                    <Text style={[styles.stepLabel, current && styles.stepLabelCurrent]} numberOfLines={1}>
                      {idx + 1}. {sub?.shop?.name ?? 'Shop'}
                    </Text>
                  </View>
                );
              })}
              <View style={styles.stepItem}>
                <View style={[styles.stepDot, allPickedUp && bulk.status === 'OUT_FOR_DELIVERY' && styles.stepDotDone]} />
                <Text style={styles.stepLabel} numberOfLines={1}>Deliver</Text>
              </View>
            </View>

            {/* Current action */}
            {!allPickedUp && currentSub ? (
              <>
                <View style={styles.leg}>
                  <Text style={styles.legLabel}>CURRENT STOP</Text>
                  <Text style={styles.legText}>{currentSub.shop?.name} — {[currentSub.shop?.addressLine, currentSub.shop?.city].filter(Boolean).join(', ')}</Text>
                </View>
                <Button
                  label="Navigate to shop"
                  variant="outline"
                  onPress={() => { const url = mapsUrl(currentSub.shop?.latitude, currentSub.shop?.longitude); if (url) void Linking.openURL(url); }}
                  style={{ marginTop: theme.space.sm }}
                />
                {open ? (
                  <View style={styles.otpBox}>
                    <Text style={styles.otpLabel}>{t.jobs.shopPickupOtp}</Text>
                    <OtpBoxes value={otp} onChange={setOtp} onComplete={(code) => confirmBulkPickup(currentSub.id, code)} length={4} />
                    {otpError ? <ErrorText>{otpError}</ErrorText> : null}
                    <View style={styles.otpActions}>
                      <Button label={t.jobs.confirmPickup} onPress={() => confirmBulkPickup(currentSub.id)} busy={busyId === currentSub.id} style={styles.flex} />
                      <Button label={t.common.cancel} variant="ghost" onPress={() => { setOpenId(null); setOtpError(null); }} style={styles.flex} />
                    </View>
                  </View>
                ) : (
                  <Button label={t.jobs.confirmPickup} onPress={() => openOtp(currentSub.id)} style={{ marginTop: theme.space.sm }} />
                )}
              </>
            ) : allPickedUp ? (
              <>
                <View style={styles.leg}>
                  <Text style={styles.legLabel}>DROP</Text>
                  <Text style={styles.legText}>{[bulk.address?.line, bulk.address?.landmark].filter(Boolean).join(', ')}</Text>
                </View>
                <Button label={t.jobs.navigateToCustomer} variant="outline" onPress={() => navigateToBulkDrop(bulk)} style={{ marginTop: theme.space.sm }} />
                {open ? (
                  <View style={styles.otpBox}>
                    {isBulkCod(bulk) ? (
                      <>
                        <View style={styles.payToggle}>
                          <Button label={t.jobs.cash} variant={codMethod === 'cash' ? 'accent' : 'outline'} small onPress={() => { setCodMethod('cash'); setQrPaid(false); }} style={styles.flex} />
                          <Button label={t.jobs.qrUpi} variant={codMethod === 'qr' ? 'accent' : 'outline'} small onPress={() => setCodMethod('qr')} style={styles.flex} />
                        </View>
                        {codMethod === 'cash' ? (
                          <Text style={styles.payHint}>{t.jobs.collectCash(formatRupees(bulk.totalPaise))}</Text>
                        ) : (
                          <>
                            <Text style={styles.payHint}>Ask customer to pay each shop's QR separately before entering the handoff OTP.</Text>
                            {(bulk.orders as Array<typeof bulk.orders[0] & { codUpiClaimedAt?: string | null; paymentConfirmed?: boolean }>).map((sub) => {
                              const upiVpa = sub.shop?.upiVpa;
                              if (!upiVpa) return null;
                              const link = buildUpiDeepLink(upiVpa, sub.shop?.name ?? 'Shop', sub.originalTotalPaise, sub.id.replace(/-/g,'').slice(0,8).toUpperCase());
                              return (
                                <View key={sub.id} style={styles.qrWrap}>
                                  <Text style={[styles.payHint, { fontWeight: '700' }]}>{sub.shop?.name} — {formatRupees(sub.originalTotalPaise)}</Text>
                                  {sub.paymentConfirmed ? (
                                    <Text style={styles.payPaid}>{t.jobs.shopConfirmedPayment(formatRupees(sub.originalTotalPaise))}</Text>
                                  ) : sub.codUpiClaimedAt ? (
                                    <Text style={styles.payWaiting}>{t.jobs.waitingShopConfirm(sub.shop?.name ?? t.jobs.theShop, formatRupees(sub.originalTotalPaise))}</Text>
                                  ) : (
                                    <>
                                      <View style={styles.qrFrame}><UpiQr link={link} size={160} /></View>
                                      <Button label={t.jobs.customerPaidNotify} variant="outline" small busy={busyId === sub.id} onPress={() => claimBulkSubUpiPaid(sub.id)} />
                                    </>
                                  )}
                                </View>
                              );
                            })}
                          </>
                        )}
                      </>
                    ) : null}
                    <Text style={styles.otpLabel}>{t.jobs.handoffOtp}</Text>
                    <OtpBoxes value={otp} onChange={setOtp} onComplete={(code) => completeBulkDelivery(bulk.id, code)} length={4} />
                    {otpError ? <ErrorText>{otpError}</ErrorText> : null}
                    <View style={styles.otpActions}>
                      <Button label={t.jobs.confirmDelivery} onPress={() => completeBulkDelivery(bulk.id)} busy={busyId === bulk.id} disabled={isBulkCod(bulk) && codMethod === 'qr' && !(bulk.orders as Array<typeof bulk.orders[0] & { paymentConfirmed?: boolean }>).every((o) => o.paymentConfirmed)} style={styles.flex} />
                      <Button label={t.common.cancel} variant="ghost" onPress={() => { setOpenId(null); setOtpError(null); }} style={styles.flex} />
                    </View>
                  </View>
                ) : (
                  <Button label={t.jobs.markDelivered} onPress={() => openOtp(bulk.id)} style={{ marginTop: theme.space.sm }} />
                )}
              </>
            ) : null}

            <View style={styles.metaRow}>
              <Text style={styles.meta}>{t.jobs.fee(formatRupees(bulk.baseDeliveryFeePaise + bulk.multiShopSurchargePaise))}</Text>
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.meta}>{isBulkCod(bulk) ? `COD ${formatRupees(bulk.totalPaise)}` : 'UPI'}</Text>
            </View>
          </Card>
        );
      })}

      {/* Available jobs */}
      <Text style={[styles.heading, hasActive ? { marginTop: theme.space.lg } : null]}>
        {jobs.some((j) => j.offerExpiresAt) || bulkJobs.some((j) => j.offerExpiresAt) ? t.jobs.newDeliveryOffer : t.jobs.availableJobs}
      </Text>
      {jobs.length === 0 && bulkJobs.length === 0 ? (
        <Banner tone="info" title={t.jobs.noOffersTitle} message={t.jobs.noOffersMessage} />
      ) : (
        <>
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} disabled={acceptingId !== null} secondsLeft={secondsLeftFor(job)} onAccept={() => accept(job.id)} onDecline={() => decline(job.id)} />
          ))}
          {bulkJobs.map((job) => (
            <BulkJobCard key={job.id} job={job} disabled={acceptingId !== null} secondsLeft={secondsLeftFor(job)} onAccept={() => acceptBulk(job.id)} onDecline={() => declineBulk(job.id)} />
          ))}
        </>
      )}
    </Screen>
  );
}

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
  disabled,
  secondsLeft,
  onAccept,
  onDecline,
}: {
  job: RiderJob;
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
          disabled={disabled}
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

function BulkJobCard({
  job,
  disabled,
  secondsLeft,
  onAccept,
  onDecline,
}: {
  job: BulkRiderJob;
  disabled: boolean;
  secondsLeft: number | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { t } = useLang();
  const isOffer = secondsLeft !== null;
  const totalItems = job.orders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.qty, 0), 0);
  const drop = [job.address?.line, job.address?.landmark].filter(Boolean).join(', ');
  const earnPaise = job.baseDeliveryFeePaise + job.multiShopSurchargePaise;
  return (
    <Card>
      {isOffer ? (
        <View style={styles.countdownRow}>
          <Text style={styles.countdownText}>{t.jobs.respondIn(secondsLeft as number)}</Text>
        </View>
      ) : null}
      <View style={styles.cardHeader}>
        <View style={styles.headerInfo}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={styles.bulkBadge}><Text style={styles.bulkBadgeText}>BULK</Text></View>
            <Text style={styles.shopName} numberOfLines={1}>{job.orders.length} shops</Text>
          </View>
          <Text style={styles.orderNo}>{job.shortId ?? `BLK${job.id.replace(/-/g,'').slice(0,8).toUpperCase()}`}</Text>
        </View>
        <Badge label={formatRupees(earnPaise)} tone="accent" />
      </View>

      {job.orders.map((sub, idx) => (
        <View key={sub.id} style={styles.leg}>
          <Text style={styles.legLabel}>STOP {idx + 1}: {sub.shop?.name?.toUpperCase()}</Text>
          <Text style={styles.legText}>{[sub.shop?.addressLine, sub.shop?.city].filter(Boolean).join(', ') || 'Nearby'}</Text>
        </View>
      ))}
      <View style={styles.leg}>
        <Text style={styles.legLabel}>DROP</Text>
        <Text style={styles.legText}>{drop || 'Customer location'}</Text>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>{t.jobs.itemCount(totalItems)}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.meta}>{t.jobs.order(formatRupees(job.totalPaise))}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={[styles.meta, styles.payTag]}>{job.paymentMethod === 'COD' ? `COD ${formatRupees(job.totalPaise)}` : 'UPI'}</Text>
      </View>

      <View style={styles.offerActions}>
        <Button label={t.jobs.acceptDelivery} onPress={onAccept} disabled={disabled} style={styles.flex} />
        {isOffer ? (
          <Button label={t.jobs.decline} variant="ghost" onPress={onDecline} disabled={disabled} style={styles.flex} />
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
  bulkBadge: { backgroundColor: '#7C3AED', borderRadius: theme.radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  bulkBadgeText: { color: '#FFFFFF', fontSize: theme.font.tiny, fontWeight: '800', letterSpacing: 0.5 },
  stepsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginBottom: theme.space.md },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.color.border, borderWidth: 1.5, borderColor: theme.color.borderStrong },
  stepDotDone: { backgroundColor: theme.color.success, borderColor: theme.color.success },
  stepDotCurrent: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  stepLabel: { fontSize: theme.font.tiny, color: theme.color.textMuted, fontWeight: '600', maxWidth: 80 },
  stepLabelCurrent: { color: theme.color.accent, fontWeight: '800' },
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
