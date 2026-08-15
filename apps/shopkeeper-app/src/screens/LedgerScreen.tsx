import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { LedgerEntryStatus, buildUpiDeepLink } from '@passwaala/shared';
import { api } from '../api';
import { formatRupees, theme } from '../theme';
import { Badge, Banner, Button, Card, Screen, SectionTitle } from '../ui';
import type { BadgeTone } from '../ui';
import { useLang } from '../i18n/LanguageContext';
import type { Strings } from '../i18n/strings';
import type { Ledger, LedgerEntry } from '../types';

/** Shape returned by api.myPnl() — all values are integer paise. */
interface Pnl {
  orderCount: number;
  grossSalesPaise: number;
  discountsGivenPaise: number;
  coinsRedeemedPaise: number;
  netItemRevenuePaise: number;
  deliveryFeesPaise: number;
  commissionPaise: number;
  platformFeePaise: number;
  codCollectedByPasswalaPaise: number;
  netPositionPaise: number;
}

/**
 * LedgerScreen — the shop's NearBaz dues. Shows outstanding dues vs the credit
 * limit as a progress bar (warning as it nears/over the limit), explains the
 * auto-pause at the limit and HOW dues are settled (manual/offline for MVP),
 * and lists ledger entries grouped per order (commission + platform fee for the
 * same order collapse into one expandable card). All money via formatRupees.
 */

/** One order's worth of ledger entries (or the null-order "Other charges"). */
interface EntryGroup {
  /** orderNumber, or null for onboarding/referral charges. */
  orderNumber: string | null;
  totalPaise: number;
  entries: LedgerEntry[];
}

/** Group entries for display:
 *  - Entries with an orderNumber → one collapsible card per order
 *  - PAYMENT entries (no order) → one standalone card each
 *  - Other null-order entries (onboarding, referral) → one grouped card
 */
function groupEntries(entries: LedgerEntry[]): EntryGroup[] {
  const byOrder = new Map<string, EntryGroup>();
  const standalone: EntryGroup[] = []; // one card per PAYMENT entry
  const other: EntryGroup = { orderNumber: null, totalPaise: 0, entries: [] };
  for (const e of entries) {
    if (e.orderNumber) {
      let g = byOrder.get(e.orderNumber);
      if (!g) {
        g = { orderNumber: e.orderNumber, totalPaise: 0, entries: [] };
        byOrder.set(e.orderNumber, g);
      }
      g.entries.push(e);
      g.totalPaise += e.totalPaise;
    } else if (e.type === 'PAYMENT') {
      standalone.push({ orderNumber: null, totalPaise: e.totalPaise, entries: [e] });
    } else {
      other.entries.push(e);
      other.totalPaise += e.totalPaise;
    }
  }
  const groups = [...byOrder.values(), ...standalone];
  if (other.entries.length > 0) groups.push(other);
  return groups;
}

/** Ledger entries fetched per page (initial load + each "Load more"). */
const PAGE_SIZE = 20;

export function LedgerScreen() {
  const { t } = useLang();
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [pnlError, setPnlError] = useState<string | null>(null);

  // Load page 1 (summary + first entries). Replaces the accumulated list.
  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError(null);
    setPnlError(null);
    try {
      const l = (await api.myLedger({ limit: PAGE_SIZE })) as Ledger;
      setLedger(l);
      setEntries(l.entries);
      setNextCursor(l.nextCursor ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // P&L is an independent all-time summary — its failure shouldn't block the ledger.
    try {
      const p = (await api.myPnl()) as Pnl;
      setPnl(p);
    } catch (e) {
      setPnlError((e as Error).message);
    }
  }, []);

  // Append the next page of entries (the summary is unchanged).
  const loadMore = useCallback(async () => {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const l = (await api.myLedger({ limit: PAGE_SIZE, cursor: nextCursor })) as Ledger;
      setEntries((prev) => [...prev, ...l.entries]);
      setNextCursor(l.nextCursor ?? null);
    } catch {
      // Keep what's loaded; the button stays for a retry.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => groupEntries(entries), [entries]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.color.accent} />
      </View>
    );
  }

  const dues = ledger?.outstandingDuesPaise ?? 0;
  const limit = ledger?.creditLimitPaise ?? 0;
  // Negative dues = advance credit the shop has paid ahead; clamp the bar at 0.
  const inCredit = dues < 0;
  const ratio = limit > 0 ? Math.min(Math.max(dues, 0) / limit, 1) : 0;
  const near = limit > 0 && dues >= limit * 0.8 && dues < limit;
  const over = limit > 0 && dues >= limit;
  const barColor = over ? theme.color.danger : near ? theme.color.warning : theme.color.primary;
  // Amount the Pay Now flow should charge by default (0 when already in credit).
  const amountDuePaise = Math.max(dues, 0);

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.color.accent} />
      }
    >
      <Text style={styles.title}>{t.ledger.title}</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* All-time P&L summary — net position banner + breakdown. */}
      <PnlCard pnl={pnl} error={pnlError} />

      {/* Dues summary + progress toward credit limit */}
      <Card>
        <Text style={styles.duesLabel}>
          {inCredit ? t.ledger.advanceCredit : t.ledger.outstandingDues}
        </Text>
        <Text
          style={[
            styles.duesValue,
            over && { color: theme.color.danger },
            inCredit && { color: theme.color.success },
          ]}
        >
          {inCredit ? `− ${formatRupees(Math.abs(dues))}` : formatRupees(dues)}
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: barColor }]} />
        </View>
        <View style={styles.limitRow}>
          <Text style={styles.limitText}>{inCredit ? t.ledger.creditBalance : t.ledger.creditLimit}</Text>
          <Text style={styles.limitText}>{formatRupees(limit)}</Text>
        </View>
      </Card>

      {inCredit ? (
        <Banner
          tone="success"
          title={t.ledger.paidAheadTitle}
          message={t.ledger.paidAheadBody}
        />
      ) : over ? (
        <Banner
          tone="danger"
          title={t.ledger.autoPausedTitle}
          message={t.ledger.autoPausedBody}
        />
      ) : near ? (
        <Banner
          tone="warning"
          title={t.ledger.nearingTitle}
          message={t.ledger.nearingBody}
        />
      ) : (
        <Banner
          tone="info"
          message={t.ledger.accrueInfo}
        />
      )}

      {/* Pay dues — actionable UPI self-pay (opens the shopkeeper's UPI app
          pre-filled with NearBaz's collection VPA + amount, then self-confirm). */}
      <PayDuesCard
        duesPaise={amountDuePaise}
        inCredit={inCredit}
        over={over}
        collectionUpi={ledger?.collectionUpi ?? null}
        t={t}
        onPaid={() => load(true)}
      />

      <SectionTitle style={{ marginTop: theme.space.sm }}>{t.ledger.chargesByOrder}</SectionTitle>
      {groups.length > 0 ? (
        groups.map((g) => {
          const key = g.orderNumber ?? '__other__';
          return (
            <OrderGroupCard
              key={key}
              group={g}
              expanded={!!expanded[key]}
              t={t}
              onToggle={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
            />
          );
        })
      ) : (
        <Text style={styles.empty}>{t.ledger.noEntries}</Text>
      )}

      {nextCursor ? (
        <Button
          label={loadingMore ? t.common.loading : t.ledger.loadMore}
          variant="outline"
          onPress={loadMore}
          busy={loadingMore}
          style={{ marginTop: theme.space.sm }}
        />
      ) : null}
    </Screen>
  );
}

/**
 * PnlCard — all-time profit & loss summary. A prominent net-position banner
 * (green when NearBaz owes the shop, amber when the shop owes NearBaz) plus a
 * line-by-line breakdown of gross sales, discounts, coins, commission, platform
 * fee, delivery fees, and COD held by NearBaz. Loads from api.myPnl() upstream.
 */
function PnlCard({ pnl, error }: { pnl: Pnl | null; error: string | null }) {
  if (error) {
    return (
      <Card>
        <SectionTitle>Profit & Loss</SectionTitle>
        <Text style={[styles.error, { marginTop: theme.space.xs }]}>Could not load P&L: {error}</Text>
      </Card>
    );
  }
  if (!pnl) {
    return (
      <Card>
        <SectionTitle>Profit & Loss</SectionTitle>
        <ActivityIndicator color={theme.color.accent} style={{ marginTop: theme.space.sm }} />
      </Card>
    );
  }

  const net = pnl.netPositionPaise;
  const owedToShop = net > 0;

  return (
    <Card style={styles.pnlCard}>
      <SectionTitle>Profit & Loss (all time)</SectionTitle>

      {/* Prominent net-position banner. */}
      <View
        style={[
          styles.pnlNetBanner,
          owedToShop ? styles.pnlNetPositive : styles.pnlNetNegative,
        ]}
      >
        <Text style={[styles.pnlNetLabel, { color: owedToShop ? theme.color.success : theme.color.warning }]}>
          {owedToShop ? 'NearBaz owes you' : 'You owe NearBaz'}
        </Text>
        <Text style={[styles.pnlNetValue, { color: owedToShop ? theme.color.success : theme.color.warning }]}>
          {formatRupees(Math.abs(net))}
        </Text>
        <Text style={styles.pnlNetSub}>
          Across {pnl.orderCount} order{pnl.orderCount === 1 ? '' : 's'}
        </Text>
      </View>

      {/* Line-by-line breakdown. */}
      <View style={styles.pnlBreakdown}>
        <PnlRow label="Gross sales" value={formatRupees(pnl.grossSalesPaise)} />
        <PnlRow
          label="Discounts you gave"
          value={`− ${formatRupees(pnl.discountsGivenPaise)}`}
          muted
        />
        <PnlRow
          label="Coins used"
          note="NearBaz-funded"
          value={formatRupees(pnl.coinsRedeemedPaise)}
          muted
        />
        <PnlRow label="Net item revenue" value={formatRupees(pnl.netItemRevenuePaise)} strong />
        <PnlRow
          label="Commission"
          value={`− ${formatRupees(pnl.commissionPaise)}`}
          muted
        />
        <PnlRow
          label="Platform fee"
          value={`− ${formatRupees(pnl.platformFeePaise)}`}
          muted
        />
        <PnlRow
          label="Delivery fees collected"
          note="pass-through"
          value={formatRupees(pnl.deliveryFeesPaise)}
          muted
        />
        <PnlRow
          label="COD collected by NearBaz"
          value={formatRupees(pnl.codCollectedByPasswalaPaise)}
          muted
        />
      </View>
    </Card>
  );
}

/** One label/value row in the P&L breakdown. */
function PnlRow({
  label,
  value,
  note,
  muted,
  strong,
}: {
  label: string;
  value: string;
  note?: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <View style={[styles.pnlRow, strong && styles.pnlRowStrong]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.pnlRowLabel, strong && styles.pnlRowLabelStrong]}>{label}</Text>
        {note ? <Text style={styles.pnlRowNote}>{note}</Text> : null}
      </View>
      <Text
        style={[
          styles.pnlRowValue,
          strong && styles.pnlRowValueStrong,
          muted && !strong && { color: theme.color.textMuted },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * PayDuesCard — the actionable "Pay dues" section. Shows the amount owed, an
 * editable "pay this much" field (default = current dues; the shopkeeper can
 * overpay to build advance credit), a Pay Now button that opens their UPI app
 * pre-filled with NearBaz's per-city collection VPA + amount, and an "I've paid"
 * self-confirm that settles the dues (POST /ledger/pay). Falls back to offline
 * copy when the city has no collection UPI configured.
 */
function PayDuesCard({
  duesPaise,
  inCredit,
  over,
  collectionUpi,
  t,
  onPaid,
}: {
  duesPaise: number;
  inCredit: boolean;
  over: boolean;
  collectionUpi: { vpa: string; name: string } | null;
  t: Strings;
  onPaid: () => void;
}) {
  const exactDefault = duesPaise > 0 ? String(duesPaise / 100) : '';
  const [amountRupees, setAmountRupees] = useState(exactDefault);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!paid) setAmountRupees(exactDefault);
  }, [duesPaise]); // eslint-disable-line react-hooks/exhaustive-deps

  const amountPaise = Math.round((parseFloat(amountRupees) || 0) * 100);
  const validAmount = amountPaise > 0;

  function openUpi() {
    if (!collectionUpi || !validAmount) return;
    setError(null);
    const link = buildUpiDeepLink(
      collectionUpi.vpa,
      collectionUpi.name,
      amountPaise,
      'NearBaz dues',
    );
    try {
      if (Platform.OS === 'web') window.open(link, '_blank');
      else void Linking.openURL(link);
      setPaid(true);
      // Fire-and-forget claim — backend records it for admin to verify
      void api.claimShopPayment(amountPaise).catch(() => undefined);
    } catch {
      setError(t.ledger.upiOpenError);
    }
  }

  return (
    <Card style={styles.payCard}>
      <SectionTitle>{t.ledger.payTitle}</SectionTitle>

      <View style={styles.payAmountRow}>
        <Text style={styles.payAmountLabel}>{inCredit ? t.ledger.currentDues : t.ledger.amountToPay}</Text>
        <Text style={[styles.payAmount, over && { color: theme.color.danger }]}>
          {formatRupees(duesPaise)}
        </Text>
      </View>

      {collectionUpi ? (
        <>
          <View style={styles.upiRow}>
            <Text style={styles.upiRowLabel}>{t.ledger.passwalaUpi}</Text>
            <Text style={styles.upiRowValue}>{collectionUpi.vpa}</Text>
          </View>

          {/* Editable pay amount — default = dues, but the shopkeeper can overpay. */}
          <Text style={styles.payFieldLabel}>{t.ledger.payFieldLabel}</Text>
          <TextInput
            style={styles.payInput}
            keyboardType="numeric"
            value={amountRupees}
            onChangeText={(val) => { setAmountRupees(val.replace(/[^0-9.]/g, '')); setError(null); }}
            placeholder="0"
            placeholderTextColor={theme.color.textFaint}
          />

          <Button
            label={validAmount ? t.ledger.payNow(amountRupees || '0') : t.ledger.enterAmount}
            onPress={openUpi}
            disabled={!validAmount}
          />
          {paid ? (
            <Banner
              tone="success"
              title={t.ledger.paymentClaimTitle}
              message={t.ledger.paymentClaimBody(amountRupees)}
            />
          ) : null}
          {error ? <Text style={styles.payError}>{error}</Text> : null}
        </>
      ) : (
        <>
          <Text style={styles.payBody}>
            {t.ledger.payOfflineBody}
          </Text>
          <Banner
            tone="info"
            message={t.ledger.noCityUpi}
          />
        </>
      )}
    </Card>
  );
}

/** A pressable card summarizing one order's charges; tap to expand line items. */
function OrderGroupCard({
  group,
  expanded,
  t,
  onToggle,
}: {
  group: EntryGroup;
  expanded: boolean;
  t: Strings;
  onToggle: () => void;
}) {
  const isOther = group.orderNumber === null && group.entries[0]?.type !== 'PAYMENT';
  const isPayment = group.entries.length === 1 && group.entries[0]?.type === 'PAYMENT';
  const credit = group.totalPaise < 0;

  let heading: string;
  let sub: string;
  if (isPayment) {
    heading = t.ledger.paymentSent;
    sub = new Date(group.entries[0].createdAt).toLocaleDateString();
  } else if (isOther) {
    heading = t.ledger.otherCharges;
    sub = t.ledger.onboardingReferral;
  } else {
    heading = `#${group.orderNumber}`;
    sub = t.ledger.chargeCount(group.entries.length);
  }

  return (
    <Pressable onPress={onToggle} style={({ pressed }) => pressed && { opacity: 0.7 }}>
      <Card style={[styles.groupCard, isPayment && styles.groupCardPayment]}>
        <View style={styles.groupTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.groupTitle}>{heading}</Text>
            <Text style={styles.groupSub}>{sub}</Text>
          </View>
          <View style={styles.groupTotalWrap}>
            <Text style={[styles.groupTotal, credit && { color: theme.color.success }]}>
              {credit ? '' : '+'}{formatRupees(group.totalPaise)}
            </Text>
            <Text style={styles.expandHint}>{expanded ? t.ledger.hide : t.ledger.details}</Text>
          </View>
        </View>

        {expanded ? (
          <View style={styles.lineItems}>
            {group.entries.map((e) => (
              <EntryLine key={e.id} entry={e} t={t} />
            ))}
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

/** One line item within an order group. */
function EntryLine({ entry, t }: { entry: LedgerEntry; t: Strings }) {
  const credit = entry.totalPaise < 0;
  const isDiscount = entry.type === 'DISCOUNT_GIVEN';
  const tone: BadgeTone =
    entry.status === LedgerEntryStatus.PAID
      ? 'success'
      : entry.status === LedgerEntryStatus.INVOICED
        ? 'info'
        : 'warning';
  return (
    <View style={styles.lineRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.lineType}>{formatType(entry.type)}</Text>
        {isDiscount ? (
          <Text style={styles.lineMeta}>
            {formatRupees(entry.basePaise)} · informational (no charge) · {new Date(entry.createdAt).toLocaleDateString()}
          </Text>
        ) : (
          <Text style={styles.lineMeta}>
            {t.ledger.base(formatRupees(entry.basePaise))} · {t.ledger.gst(formatRupees(entry.gstPaise))} · {new Date(entry.createdAt).toLocaleDateString()}
          </Text>
        )}
      </View>
      <View style={styles.lineRight}>
        <Text style={[styles.lineTotal, credit && { color: theme.color.success }]}>
          {isDiscount ? '—' : `${credit ? '' : '+'}${formatRupees(entry.totalPaise)}`}
        </Text>
        <Badge label={entry.status} tone={tone} />
      </View>
    </View>
  );
}

/** Clear, shopkeeper-facing labels for ledger entry types. */
const ENTRY_LABELS: Record<string, string> = {
  DISCOUNT_GIVEN: 'Discount you gave',
  COD_REMITTANCE: 'COD held by NearBaz (owed to you)',
  RIDER_DELIVERY_FEE: 'Delivery fee (to rider)',
  SHOP_PAYOUT: 'NearBaz paid you',
};

function formatType(type: string): string {
  const mapped = ENTRY_LABELS[type];
  if (mapped) return mapped;
  return type
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: theme.font.h1, fontWeight: '900', color: theme.color.text },
  error: { color: theme.color.danger, fontSize: theme.font.small, fontWeight: '600' },

  duesLabel: { fontSize: theme.font.small, color: theme.color.textMuted },
  duesValue: { fontSize: theme.font.display, fontWeight: '900', color: theme.color.text, marginTop: 2 },

  // P&L summary
  pnlCard: { gap: theme.space.sm },
  pnlNetBanner: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    padding: theme.space.md,
    marginTop: theme.space.xs,
  },
  pnlNetPositive: { backgroundColor: theme.color.successSoft, borderColor: '#BFE3CE' },
  pnlNetNegative: { backgroundColor: theme.color.warningSoft, borderColor: '#F3D9B5' },
  pnlNetLabel: { fontSize: theme.font.small, fontWeight: '700' },
  pnlNetValue: { fontSize: theme.font.h1, fontWeight: '900', marginTop: 2 },
  pnlNetSub: { fontSize: theme.font.tiny, color: theme.color.textMuted, marginTop: 2 },
  pnlBreakdown: {
    gap: theme.space.xs,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingTop: theme.space.sm,
  },
  pnlRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
  pnlRowStrong: {
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingTop: theme.space.xs,
    marginTop: 2,
  },
  pnlRowLabel: { fontSize: theme.font.small, color: theme.color.text },
  pnlRowLabelStrong: { fontWeight: '800' },
  pnlRowNote: { fontSize: theme.font.tiny, color: theme.color.textFaint, marginTop: 1 },
  pnlRowValue: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  pnlRowValueStrong: { fontWeight: '900', fontSize: theme.font.body },

  progressTrack: {
    height: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    overflow: 'hidden',
    marginTop: theme.space.md,
  },
  progressFill: { height: '100%', borderRadius: theme.radius.pill },
  limitRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.space.sm },
  limitText: { fontSize: theme.font.tiny, color: theme.color.textMuted },

  payCard: { gap: theme.space.sm },
  payAmountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: theme.space.xs },
  payAmountLabel: { fontSize: theme.font.small, color: theme.color.textMuted },
  payAmount: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text },
  payBody: { fontSize: theme.font.small, color: theme.color.textMuted, lineHeight: 20 },
  upiRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: theme.space.xs },
  upiRowLabel: { fontSize: theme.font.small, color: theme.color.textMuted },
  upiRowValue: { fontSize: theme.font.body, fontWeight: '800', color: theme.color.text },
  payFieldLabel: { fontSize: theme.font.tiny, color: theme.color.textMuted, marginTop: theme.space.sm },
  payInput: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
    fontSize: theme.font.h3,
    fontWeight: '800',
    color: theme.color.text,
    backgroundColor: theme.color.surfaceAlt,
    marginBottom: theme.space.sm,
  },
  payError: { color: theme.color.danger, fontSize: theme.font.small, fontWeight: '600' },

  groupCard: { padding: theme.space.md, gap: theme.space.sm },
  groupCardPayment: { borderColor: theme.color.primary, borderWidth: 1.5 },
  groupTop: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
  groupTitle: { fontWeight: '900', fontSize: theme.font.body, color: theme.color.text },
  groupSub: { fontSize: theme.font.tiny, color: theme.color.textMuted, marginTop: 2 },
  groupTotalWrap: { alignItems: 'flex-end', gap: 2 },
  groupTotal: { fontWeight: '900', color: theme.color.text, fontSize: theme.font.h3 },
  expandHint: { fontSize: theme.font.tiny, color: theme.color.accent, fontWeight: '700' },

  lineItems: {
    gap: theme.space.sm,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingTop: theme.space.sm,
  },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
  lineType: { fontWeight: '700', color: theme.color.text, fontSize: theme.font.small },
  lineMeta: { fontSize: theme.font.tiny, color: theme.color.textMuted, marginTop: 2 },
  lineRight: { alignItems: 'flex-end', gap: 4 },
  lineTotal: { fontWeight: '800', color: theme.color.text, fontSize: theme.font.small },

  empty: { color: theme.color.textMuted, textAlign: 'center', marginTop: theme.space.lg },
});
