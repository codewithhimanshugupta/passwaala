import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import type { AdShopDrilldown, AdCampaignView, AdSeriesPoint, AdCampaignStatus } from '@passwaala/shared';
import { api } from '../api';
import { formatRupees, rupeeInputToPaise, paiseToRupeeInput, theme } from '../theme';
import { Badge, Button, Card, ErrorText, Field } from '../ui';
import type { BadgeTone } from '../ui';
import { useLang } from '../i18n/LanguageContext';
import type { Strings } from '../i18n/strings';

/**
 * AdsScreen — the shop's own ad promotion + stats. Shows own campaign
 * performance (impressions/clicks/CTR/spend + outstanding dues), a lightweight
 * View-based bar chart of the daily series, an opt-in flow when not yet
 * promoting, and per-campaign controls: pause/resume (setAdActive) + a daily
 * spend cap (setAdDailyBudget). CPC is admin-set and shown read-only.
 */
export function AdsScreen() {
  const { t } = useLang();
  const [data, setData] = useState<AdShopDrilldown | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      setData(await api.myAds());
    } catch (e) {
      setError((e as Error).message || t.ads.loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.color.accent} />
      </View>
    );
  }

  const hasCampaign = (data?.campaigns.length ?? 0) > 0;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.color.accent} />
      }
    >
      <View>
        <Text style={styles.title}>{t.ads.title}</Text>
        <Text style={styles.subtitle}>{t.ads.subtitle}</Text>
      </View>

      {error ? <ErrorText>{error}</ErrorText> : null}

      {!hasCampaign ? (
        <OptInCard t={t} onOptedIn={() => load()} />
      ) : data ? (
        <>
          <TotalsCard data={data} t={t} />
          <ChartCard series={data.series} t={t} />
          {data.campaigns.map((c) => (
            <CampaignCard key={c.id} campaign={c} t={t} onChanged={(updated) => {
              setData((prev) =>
                prev ? { ...prev, campaigns: prev.campaigns.map((x) => (x.id === updated.id ? updated : x)) } : prev,
              );
            }} />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

/* --------------------------------- Opt-in --------------------------------- */

function OptInCard({ t, onOptedIn }: { t: Strings; onOptedIn: () => void }) {
  const [totalBudget, setTotalBudget] = useState('');
  const [dailyBudget, setDailyBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function optIn() {
    setBusy(true);
    setError(null);
    try {
      await api.optInAds({
        totalBudgetPaise: totalBudget.trim() ? rupeeInputToPaise(totalBudget) : undefined,
        dailyBudgetPaise: dailyBudget.trim() ? rupeeInputToPaise(dailyBudget) : undefined,
      });
      onOptedIn();
    } catch (e) {
      setError((e as Error).message || t.ads.optInError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>{t.ads.notOptedInTitle}</Text>
      <Text style={styles.hint}>{t.ads.notOptedInBody}</Text>
      <Field
        label={t.ads.totalBudget}
        placeholder={t.ads.zeroPlaceholder}
        keyboardType="decimal-pad"
        value={totalBudget}
        onChangeText={setTotalBudget}
        hint={t.ads.totalBudgetHint}
      />
      <Field
        label={t.ads.dailyBudget}
        placeholder={t.ads.zeroPlaceholder}
        keyboardType="decimal-pad"
        value={dailyBudget}
        onChangeText={setDailyBudget}
        hint={t.ads.dailyBudgetHint}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label={t.ads.optIn} onPress={optIn} busy={busy} />
    </Card>
  );
}

/* --------------------------------- Totals --------------------------------- */

/** Format a fractional CTR (0..1) as a percentage string. */
function formatCtr(ctr: number): string {
  return `${(ctr * 100).toFixed(1)}%`;
}

function TotalsCard({ data, t }: { data: AdShopDrilldown; t: Strings }) {
  const { totals } = data;
  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>{t.ads.totalsTitle}</Text>
      <View style={styles.tileGrid}>
        <StatTile label={t.ads.impressions} value={String(totals.impressions)} />
        <StatTile label={t.ads.clicks} value={String(totals.clicks)} />
        <StatTile label={t.ads.ctr} value={formatCtr(totals.ctr)} />
        <StatTile label={t.ads.spent} value={formatRupees(totals.spentPaise)} />
      </View>
      <View style={styles.duesRow}>
        <Text style={styles.duesLabel}>{t.ads.outstandingDues}</Text>
        <Text style={styles.duesValue}>{formatRupees(data.outstandingAdDuesPaise)}</Text>
      </View>
      <Text style={styles.hint}>{t.ads.duesHint}</Text>
    </Card>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

/* --------------------------------- Chart ---------------------------------- */

/** Short bucket label from an ISO date, e.g. "16 Aug". */
function bucketLabel(bucket: string): string {
  const d = new Date(bucket);
  if (Number.isNaN(d.getTime())) return bucket;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const CHART_HEIGHT = 120;

/**
 * A dependency-free grouped bar chart: two bars per bucket (impressions in the
 * partner accent, clicks in the brand green), each height scaled to the max
 * value across the whole series. A legend names both series so identity never
 * relies on color alone.
 */
function ChartCard({ series, t }: { series: AdSeriesPoint[]; t: Strings }) {
  const max = useMemo(
    () => series.reduce((m, p) => Math.max(m, p.impressions, p.clicks), 0),
    [series],
  );
  const hasData = series.length > 0 && max > 0;

  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>{t.ads.chartTitle}</Text>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: theme.color.accent }]} />
          <Text style={styles.legendText}>{t.ads.chartImpressions}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: theme.color.primary }]} />
          <Text style={styles.legendText}>{t.ads.chartClicks}</Text>
        </View>
      </View>

      {!hasData ? (
        <Text style={styles.hint}>{t.ads.chartEmpty}</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chartRow}>
          {series.map((p) => (
            <View key={p.bucket} style={styles.chartCol}>
              <View style={styles.chartBars}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: Math.max(2, Math.round((p.impressions / max) * CHART_HEIGHT)),
                      backgroundColor: theme.color.accent,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.bar,
                    {
                      height: Math.max(2, Math.round((p.clicks / max) * CHART_HEIGHT)),
                      backgroundColor: theme.color.primary,
                    },
                  ]}
                />
              </View>
              <Text style={styles.chartLabel} numberOfLines={1}>{bucketLabel(p.bucket)}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </Card>
  );
}

/* -------------------------------- Campaign -------------------------------- */

function campaignStatusMeta(status: AdCampaignStatus, t: Strings): { label: string; tone: BadgeTone } {
  switch (status) {
    case 'ACTIVE':
      return { label: t.ads.statusActive, tone: 'success' };
    case 'PAUSED':
      return { label: t.ads.statusPaused, tone: 'neutral' };
    case 'EXHAUSTED':
      return { label: t.ads.statusExhausted, tone: 'warning' };
    case 'EXPIRED':
      return { label: t.ads.statusExpired, tone: 'danger' };
    default:
      return { label: status, tone: 'neutral' };
  }
}

function CampaignCard({
  campaign,
  t,
  onChanged,
}: {
  campaign: AdCampaignView;
  t: Strings;
  onChanged: (updated: AdCampaignView) => void;
}) {
  const [toggling, setToggling] = useState(false);
  const [dailyCap, setDailyCap] = useState(paiseToRupeeInput(campaign.dailyBudgetPaise));
  const [savingCap, setSavingCap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const meta = campaignStatusMeta(campaign.status, t);
  // Only ACTIVE/PAUSED can be toggled; EXHAUSTED/EXPIRED are terminal-ish.
  const canToggle = campaign.status === 'ACTIVE' || campaign.status === 'PAUSED';

  async function toggleActive(next: boolean) {
    setToggling(true);
    setError(null);
    setSavedNote(null);
    try {
      onChanged(await api.setAdActive(campaign.id, next));
    } catch (e) {
      setError((e as Error).message || t.ads.updateError);
    } finally {
      setToggling(false);
    }
  }

  async function saveCap() {
    setSavingCap(true);
    setError(null);
    setSavedNote(null);
    try {
      const updated = await api.setAdDailyBudget(campaign.id, rupeeInputToPaise(dailyCap));
      onChanged(updated);
      setDailyCap(paiseToRupeeInput(updated.dailyBudgetPaise));
      setSavedNote(t.ads.dailyCapSaved);
    } catch (e) {
      setError((e as Error).message || t.ads.updateError);
    } finally {
      setSavingCap(false);
    }
  }

  return (
    <Card style={styles.section}>
      <View style={styles.campaignHeader}>
        <Text style={styles.sectionTitle}>{t.ads.campaignTitle}</Text>
        <Badge {...meta} />
      </View>

      {/* CPC — read-only (admin-set) */}
      <View style={styles.infoRow}>
        <View style={styles.flex}>
          <Text style={styles.infoLabel}>{t.ads.cpc}</Text>
          <Text style={styles.infoHint}>{t.ads.cpcHint}</Text>
        </View>
        <Text style={styles.infoValue}>{formatRupees(campaign.cpcPaise)}</Text>
      </View>

      {/* Serving indicator */}
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>{t.ads.status}</Text>
        <Badge
          label={campaign.serving ? t.ads.serving : t.ads.notServing}
          tone={campaign.serving ? 'success' : 'neutral'}
        />
      </View>

      {/* Budget usage */}
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>{t.ads.spent}</Text>
        <Text style={styles.infoValue}>
          {campaign.totalBudgetPaise > 0
            ? t.ads.spentOfTotal(formatRupees(campaign.spentPaise), formatRupees(campaign.totalBudgetPaise))
            : formatRupees(campaign.spentPaise)}
        </Text>
      </View>
      <Text style={styles.infoHint}>{t.ads.spentToday(formatRupees(campaign.spentTodayPaise))}</Text>

      {/* Pause / resume */}
      <View style={styles.toggleRow}>
        <View style={styles.flex}>
          <Text style={styles.infoLabel}>{t.ads.active}</Text>
          <Text style={styles.infoHint}>{t.ads.activeHint}</Text>
        </View>
        {toggling ? (
          <ActivityIndicator color={theme.color.accent} />
        ) : (
          <Switch
            value={campaign.status === 'ACTIVE'}
            onValueChange={toggleActive}
            disabled={!canToggle}
            trackColor={{ false: theme.color.borderStrong, true: theme.color.primary }}
            thumbColor={theme.color.white}
          />
        )}
      </View>

      {/* Daily cap */}
      <Field
        label={t.ads.dailyCap}
        placeholder={t.ads.zeroPlaceholder}
        keyboardType="decimal-pad"
        value={dailyCap}
        onChangeText={setDailyCap}
        hint={t.ads.dailyCapHint}
      />
      <Button label={t.ads.saveDailyCap} variant="outline" small onPress={saveCap} busy={savingCap} />

      {savedNote ? <Text style={styles.savedNote}>{savedNote}</Text> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: theme.color.bg },
  content: { padding: theme.space.lg, gap: theme.space.md, paddingBottom: theme.space.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  title: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text },
  subtitle: { fontSize: theme.font.small, color: theme.color.textMuted },

  section: { gap: theme.space.sm },
  sectionTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  hint: { fontSize: theme.font.tiny, color: theme.color.textMuted },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  tile: {
    flexGrow: 1,
    flexBasis: '46%',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    gap: 2,
  },
  tileValue: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text },
  tileLabel: { fontSize: theme.font.tiny, color: theme.color.textMuted, fontWeight: '600' },

  duesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: theme.space.sm,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  duesLabel: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  duesValue: { fontSize: theme.font.h3, fontWeight: '900', color: theme.color.warning },

  legendRow: { flexDirection: 'row', gap: theme.space.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontSize: theme.font.tiny, color: theme.color.textMuted, fontWeight: '600' },

  chartRow: { flexDirection: 'row', gap: theme.space.md, paddingTop: theme.space.sm, alignItems: 'flex-end' },
  chartCol: { alignItems: 'center', gap: theme.space.xs, width: 44 },
  chartBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: CHART_HEIGHT },
  bar: { width: 12, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  chartLabel: { fontSize: theme.font.tiny, color: theme.color.textFaint },

  campaignHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md },
  infoLabel: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  infoHint: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  infoValue: { fontSize: theme.font.body, fontWeight: '800', color: theme.color.text },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    paddingTop: theme.space.sm,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  flex: { flex: 1 },
  savedNote: { fontSize: theme.font.small, color: theme.color.success, fontWeight: '600' },
});
