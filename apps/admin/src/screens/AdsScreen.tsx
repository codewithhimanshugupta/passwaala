import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '@passwaala/api-client';
import type {
  AdShopCard,
  AdShopDrilldown,
  AdCampaignView,
  AdSeriesPoint,
  CreateAdCampaign,
  UpdateAdCampaign,
} from '@passwaala/shared';
import { api } from '../api';
import { theme } from '../theme';
import { EditIcon, DeleteIcon } from '../EditDeleteIcons';

/**
 * AdsScreen — the admin ads back office (Feature 1).
 *
 * Two levels: (1) an all-shops grid where every shop is a card showing its ad
 * rollups (impressions / clicks / CTR / spend) + a Premium curation toggle, with
 * global totals tiles on top; (2) a per-shop drill-down (tap a card) with the
 * shop's totals, a lightweight bar chart of the last N days, and full campaign
 * CRUD (create / price / pause / delete). Money is paise everywhere; the shop is
 * billed CPC and dues settle at day-end (server cron), so this screen is purely
 * configuration + analytics.
 */

const RANGE_OPTIONS = [7, 14, 30] as const;
type Range = (typeof RANGE_OPTIONS)[number];

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#059669',
  PAUSED: '#B45309',
  EXHAUSTED: '#B91C1C',
  EXPIRED: '#64748B',
};

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function StatTile({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View style={s.tile}>
      <Text style={[s.tileValue, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={s.tileLabel}>{label}</Text>
    </View>
  );
}

/** A pure View-based grouped bar chart (impressions + clicks per day). No deps. */
function MiniBarChart({ series }: { series: AdSeriesPoint[] }) {
  const maxImp = Math.max(1, ...series.map((p) => p.impressions));
  if (series.length === 0) {
    return <Text style={s.chartEmpty}>No activity in this range yet.</Text>;
  }
  return (
    <View style={s.chart}>
      <View style={s.chartBars}>
        {series.map((p) => {
          const impH = Math.round((p.impressions / maxImp) * 96);
          const clkH = Math.round((p.clicks / maxImp) * 96);
          return (
            <View key={p.bucket} style={s.chartCol}>
              <View style={s.chartColBars}>
                <View style={[s.bar, s.barImp, { height: Math.max(2, impH) }]} />
                <View style={[s.bar, s.barClk, { height: Math.max(2, clkH) }]} />
              </View>
              <Text style={s.chartXLabel}>{fmtDate(p.bucket).split(' ')[0]}</Text>
            </View>
          );
        })}
      </View>
      <View style={s.legend}>
        <View style={s.legendItem}><View style={[s.legendDot, s.barImp]} /><Text style={s.legendText}>Impressions</Text></View>
        <View style={s.legendItem}><View style={[s.legendDot, s.barClk]} /><Text style={s.legendText}>Clicks</Text></View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Campaign create / edit form (admin sets CPC + budgets)
// ---------------------------------------------------------------------------

function CampaignForm({
  shopId,
  initial,
  saving,
  onSave,
  onCancel,
}: {
  shopId: string;
  initial?: AdCampaignView;
  saving: boolean;
  onSave: (data: CreateAdCampaign | UpdateAdCampaign) => void;
  onCancel: () => void;
}) {
  const [cpc, setCpc] = useState(initial ? String(initial.cpcPaise / 100) : '');
  const [total, setTotal] = useState(initial ? String(initial.totalBudgetPaise / 100) : '');
  const [daily, setDaily] = useState(initial?.dailyBudgetPaise ? String(initial.dailyBudgetPaise / 100) : '');
  const [endAt, setEndAt] = useState(initial?.endAt ? initial.endAt.slice(0, 10) : '');

  function handleSave() {
    const cpcPaise = Math.round((parseFloat(cpc) || 0) * 100);
    const totalBudgetPaise = Math.round((parseFloat(total) || 0) * 100);
    const dailyBudgetPaise = daily.trim() ? Math.round((parseFloat(daily) || 0) * 100) : 0;
    const endIso = endAt ? new Date(endAt).toISOString() : null;
    if (initial) {
      onSave({ cpcPaise, totalBudgetPaise, dailyBudgetPaise, endAt: endIso } as UpdateAdCampaign);
    } else {
      onSave({ shopId, cpcPaise, totalBudgetPaise, dailyBudgetPaise, endAt: endIso } as CreateAdCampaign);
    }
  }

  const canSave = parseFloat(cpc) > 0 && parseFloat(total) > 0;

  return (
    <View style={f.card}>
      <Text style={f.heading}>{initial ? 'Edit Campaign' : 'New Sponsored Campaign'}</Text>
      <View style={f.row2}>
        <View style={f.col}>
          <Text style={f.label}>Cost per click ₹ *</Text>
          <TextInput style={f.input} value={cpc} onChangeText={setCpc} keyboardType="decimal-pad"
            placeholder="e.g. 2.00" placeholderTextColor={theme.color.textFaint} />
        </View>
        <View style={f.col}>
          <Text style={f.label}>Total budget ₹ *</Text>
          <TextInput style={f.input} value={total} onChangeText={setTotal} keyboardType="decimal-pad"
            placeholder="e.g. 500" placeholderTextColor={theme.color.textFaint} />
        </View>
      </View>
      <View style={f.row2}>
        <View style={f.col}>
          <Text style={f.label}>Daily cap ₹ (0 = none)</Text>
          <TextInput style={f.input} value={daily} onChangeText={setDaily} keyboardType="decimal-pad"
            placeholder="Optional" placeholderTextColor={theme.color.textFaint} />
        </View>
        <View style={f.col}>
          <Text style={f.label}>End date (optional)</Text>
          <TextInput style={f.input} value={endAt} onChangeText={setEndAt}
            placeholder="YYYY-MM-DD" placeholderTextColor={theme.color.textFaint} />
        </View>
      </View>
      <View style={f.actions}>
        <Pressable style={f.cancelBtn} onPress={onCancel}><Text style={f.cancelBtnText}>Cancel</Text></Pressable>
        <Pressable style={[f.saveBtn, (saving || !canSave) && f.saveBtnDim]} disabled={saving || !canSave} onPress={handleSave}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={f.saveBtnText}>{initial ? 'Save' : 'Create'}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Per-shop drill-down
// ---------------------------------------------------------------------------

function ShopDrilldown({
  shopId,
  range,
  onBack,
  flash,
}: {
  shopId: string;
  range: Range;
  onBack: () => void;
  flash: (m: string) => void;
}) {
  const [data, setData] = useState<AdShopDrilldown | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdCampaignView | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.adminAdsShopDrilldown(shopId, range));
    } catch (e) {
      flash(`Error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [shopId, range, flash]);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate(dto: CreateAdCampaign | UpdateAdCampaign) {
    setSaving(true);
    try {
      await api.adminCreateCampaign(dto as CreateAdCampaign);
      flash('Campaign created');
      setCreating(false);
      await load();
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
    finally { setSaving(false); }
  }

  async function handleUpdate(id: string, dto: UpdateAdCampaign) {
    setSaving(true);
    try {
      await api.adminUpdateCampaign(id, dto);
      flash('Campaign updated');
      setEditing(null);
      await load();
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
    finally { setSaving(false); }
  }

  async function handleToggle(c: AdCampaignView) {
    const next = c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      await api.adminUpdateCampaign(c.id, { status: next as AdCampaignView['status'] });
      await load();
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
  }

  async function handleDelete(id: string) {
    try {
      await api.adminDeleteCampaign(id);
      flash('Campaign deleted');
      await load();
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
  }

  if (loading && !data) return <ActivityIndicator color={theme.color.accent} style={{ margin: 48 }} />;
  if (!data) return null;

  return (
    <ScrollView contentContainerStyle={s.body}>
      <Pressable style={s.backBtn} onPress={onBack}><Text style={s.backBtnText}>← All shops</Text></Pressable>
      <Text style={s.h1}>{data.shopName}</Text>
      <Text style={s.sub}>Ads performance · last {range} days</Text>

      <View style={s.tiles}>
        <StatTile label="Impressions" value={String(data.totals.impressions)} />
        <StatTile label="Clicks" value={String(data.totals.clicks)} tint={theme.color.accent} />
        <StatTile label="CTR" value={pct(data.totals.ctr)} />
        <StatTile label="Spend" value={rupees(data.totals.spentPaise)} />
        <StatTile label="Ad dues" value={rupees(data.outstandingAdDuesPaise)} tint={theme.color.critical} />
      </View>

      <View style={s.panel}>
        <Text style={s.panelTitle}>Daily activity</Text>
        <MiniBarChart series={data.series} />
      </View>

      <View style={s.headerRow}>
        <Text style={s.panelTitle}>Campaigns ({data.campaigns.length})</Text>
        {!creating && !editing ? (
          <Pressable style={s.createBtn} onPress={() => setCreating(true)}>
            <Text style={s.createBtnText}>+ New campaign</Text>
          </Pressable>
        ) : null}
      </View>

      {creating ? (
        <CampaignForm shopId={shopId} saving={saving} onCancel={() => setCreating(false)} onSave={handleCreate} />
      ) : null}
      {editing ? (
        <CampaignForm shopId={shopId} initial={editing} saving={saving}
          onCancel={() => setEditing(null)} onSave={(d) => handleUpdate(editing.id, d as UpdateAdCampaign)} />
      ) : null}

      {data.campaigns.map((c) => (
        <View key={c.id} style={s.campaignCard}>
          <View style={s.campaignHead}>
            <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[c.status] ?? '#64748B' }]}>
              <Text style={s.statusBadgeText}>{c.status}</Text>
            </View>
            {c.serving ? <View style={s.servingDot} /> : null}
            <Text style={s.campaignCpc}>{rupees(c.cpcPaise)}/click</Text>
            <View style={{ flex: 1 }} />
            <Switch value={c.status === 'ACTIVE'} onValueChange={() => handleToggle(c)}
              trackColor={{ false: theme.color.border, true: theme.color.primary }} thumbColor="#fff" />
            <Pressable style={s.iconBtn} onPress={() => setEditing(c)}><EditIcon size={18} color={theme.color.text} /></Pressable>
            <Pressable style={s.iconBtn} onPress={() => handleDelete(c.id)}><DeleteIcon size={18} color={theme.color.critical} /></Pressable>
          </View>
          <Text style={s.campaignMeta}>
            Spent {rupees(c.spentPaise)} / {rupees(c.totalBudgetPaise)}
            {c.dailyBudgetPaise > 0 ? `  ·  Today ${rupees(c.spentTodayPaise)} / ${rupees(c.dailyBudgetPaise)}` : ''}
          </Text>
          <Text style={s.campaignMeta}>
            {c.impressions} impressions · {c.clicks} clicks · CTR {pct(c.ctr)} · from {fmtDate(c.startAt)}
            {c.endAt ? ` to ${fmtDate(c.endAt)}` : ''}
          </Text>
        </View>
      ))}

      {data.campaigns.length === 0 && !creating ? (
        <View style={s.empty}><Text style={s.emptyText}>No campaigns yet. Create one to promote this shop.</Text></View>
      ) : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Main screen: global totals + all-shops grid
// ---------------------------------------------------------------------------

export function AdsScreen() {
  const [cards, setCards] = useState<AdShopCard[]>([]);
  const [analyticsTotals, setAnalyticsTotals] = useState<AdShopDrilldown['totals'] | null>(null);
  const [series, setSeries] = useState<AdSeriesPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [range, setRange] = useState<Range>(7);
  const [selectedShop, setSelectedShop] = useState<string | null>(null);
  const [premiumBusy, setPremiumBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const flash = useCallback((msg: string) => {
    setBanner(msg);
    setTimeout(() => setBanner(null), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [shopCards, analytics] = await Promise.all([
        api.adminAdsShops(),
        api.adminAdsAnalytics(range),
      ]);
      setCards(shopCards);
      setAnalyticsTotals(analytics.totals);
      setSeries(analytics.series);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else flash(`Error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [range, flash]);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  async function togglePremium(card: AdShopCard, next: boolean) {
    setPremiumBusy(card.shopId);
    // Optimistic flip.
    setCards((list) => list.map((c) => (c.shopId === card.shopId ? { ...c, isPremium: next } : c)));
    try {
      await api.adminSetPremium(card.shopId, next);
      flash(next ? `${card.shopName} added to Premium` : `${card.shopName} removed from Premium`);
    } catch (e) {
      setCards((list) => list.map((c) => (c.shopId === card.shopId ? { ...c, isPremium: !next } : c)));
      flash(`Error: ${(e as Error).message}`);
    }
    finally { setPremiumBusy(null); }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => c.shopName.toLowerCase().includes(q) || c.city.toLowerCase().includes(q));
  }, [cards, query]);

  if (forbidden) return (
    <View style={s.center}><Text style={s.forbiddenText}>Admin access required.</Text></View>
  );

  if (selectedShop) {
    return (
      <View style={s.wrap}>
        {banner ? <View style={s.banner}><Text style={s.bannerText}>{banner}</Text></View> : null}
        <ShopDrilldown shopId={selectedShop} range={range} onBack={() => { setSelectedShop(null); void load(); }} flash={flash} />
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      {banner ? <View style={s.banner}><Text style={s.bannerText}>{banner}</Text></View> : null}
      <ScrollView contentContainerStyle={s.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>Sponsored Ads</Text>
            <Text style={s.sub}>CPC campaigns · billed at day-end · tap a shop to manage</Text>
          </View>
          <View style={s.rangeRow}>
            {RANGE_OPTIONS.map((r) => (
              <Pressable key={r} style={[s.rangeBtn, range === r && s.rangeBtnActive]} onPress={() => setRange(r)}>
                <Text style={[s.rangeBtnText, range === r && s.rangeBtnTextActive]}>{r}d</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {analyticsTotals ? (
          <View style={s.tiles}>
            <StatTile label="Campaigns" value={String(analyticsTotals.campaigns)} />
            <StatTile label="Active" value={String(analyticsTotals.activeCampaigns)} tint={theme.color.accent} />
            <StatTile label="Impressions" value={String(analyticsTotals.impressions)} />
            <StatTile label="Clicks" value={String(analyticsTotals.clicks)} />
            <StatTile label="CTR" value={pct(analyticsTotals.ctr)} />
            <StatTile label="Spend" value={rupees(analyticsTotals.spentPaise)} />
          </View>
        ) : null}

        <View style={s.panel}>
          <Text style={s.panelTitle}>Platform-wide daily activity</Text>
          <MiniBarChart series={series} />
        </View>

        <TextInput style={s.search} value={query} onChangeText={setQuery}
          placeholder="Search shops by name or city" placeholderTextColor={theme.color.textFaint} />

        {loading ? <ActivityIndicator color={theme.color.accent} style={{ margin: 32 }} /> : null}

        <View style={s.grid}>
          {filtered.map((card) => (
            <Pressable key={card.shopId} style={s.shopCard} onPress={() => setSelectedShop(card.shopId)}>
              <View style={s.shopCardHead}>
                <Text style={s.shopName} numberOfLines={1}>{card.shopName}</Text>
                {card.isPromoted ? <View style={s.adBadge}><Text style={s.adBadgeText}>AD</Text></View> : null}
              </View>
              <Text style={s.shopMeta} numberOfLines={1}>{card.shopCategory} · {card.city}</Text>
              <View style={s.shopStats}>
                <View style={s.shopStat}><Text style={s.shopStatVal}>{card.impressions}</Text><Text style={s.shopStatLbl}>Impr.</Text></View>
                <View style={s.shopStat}><Text style={s.shopStatVal}>{card.clicks}</Text><Text style={s.shopStatLbl}>Clicks</Text></View>
                <View style={s.shopStat}><Text style={s.shopStatVal}>{pct(card.ctr)}</Text><Text style={s.shopStatLbl}>CTR</Text></View>
                <View style={s.shopStat}><Text style={s.shopStatVal}>{rupees(card.spentPaise)}</Text><Text style={s.shopStatLbl}>Spend</Text></View>
              </View>
              <View style={s.premiumRow}>
                <Text style={s.premiumLabel}>⭐ Premium (curated, not billed)</Text>
                <Switch
                  value={card.isPremium}
                  onValueChange={(v) => togglePremium(card, v)}
                  disabled={premiumBusy === card.shopId}
                  trackColor={{ false: theme.color.border, true: theme.color.primary }} thumbColor="#fff" />
              </View>
              <Text style={s.campaignCount}>{card.campaignCount} campaign{card.campaignCount !== 1 ? 's' : ''} · tap to manage →</Text>
            </Pressable>
          ))}
        </View>

        {!loading && filtered.length === 0 ? (
          <View style={s.empty}><Text style={s.emptyText}>No shops found.</Text></View>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  wrap: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  forbiddenText: { color: theme.color.critical, fontSize: theme.font.body },
  banner: { backgroundColor: theme.color.primary, paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl },
  bannerText: { color: '#fff', fontWeight: '600', fontSize: theme.font.small },
  body: { padding: theme.space.xl, gap: theme.space.lg, maxWidth: 1100 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: theme.space.md },
  h1: { fontSize: theme.font.h1, fontWeight: '800', color: theme.color.text },
  sub: { fontSize: theme.font.body, color: theme.color.textMuted, marginTop: 2 },
  rangeRow: { flexDirection: 'row', gap: theme.space.xs },
  rangeBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.md, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  rangeBtnActive: { borderColor: theme.color.accent, backgroundColor: theme.color.accent },
  rangeBtnText: { fontSize: theme.font.small, color: theme.color.textMuted, fontWeight: '700' },
  rangeBtnTextActive: { color: '#fff' },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md },
  tile: { flexGrow: 1, minWidth: 120, backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, padding: theme.space.lg },
  tileValue: { fontSize: theme.font.h2, fontWeight: '800', color: theme.color.text },
  tileLabel: { fontSize: theme.font.tiny, color: theme.color.textMuted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },

  panel: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, padding: theme.space.lg, gap: theme.space.md },
  panelTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },

  chart: { gap: theme.space.sm },
  chartEmpty: { color: theme.color.textMuted, fontSize: theme.font.small, paddingVertical: theme.space.lg },
  chartBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 120 },
  chartCol: { flex: 1, alignItems: 'center', gap: 4 },
  chartColBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 100 },
  bar: { width: 8, borderRadius: 2 },
  barImp: { backgroundColor: '#93C5FD' },
  barClk: { backgroundColor: theme.color.accent },
  chartXLabel: { fontSize: 9, color: theme.color.textFaint },
  legend: { flexDirection: 'row', gap: theme.space.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: theme.font.tiny, color: theme.color.textMuted },

  search: { borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md, padding: theme.space.md, fontSize: theme.font.body, color: theme.color.text, backgroundColor: theme.color.surface },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md },
  shopCard: { width: 320, flexGrow: 1, maxWidth: 360, backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, padding: theme.space.lg, gap: theme.space.sm },
  shopCardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  shopName: { flex: 1, fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  adBadge: { backgroundColor: '#F59E0B', borderRadius: theme.radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  adBadgeText: { color: '#fff', fontWeight: '900', fontSize: 10, letterSpacing: 0.5 },
  shopMeta: { fontSize: theme.font.small, color: theme.color.textMuted },
  shopStats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.space.sm },
  shopStat: { alignItems: 'center' },
  shopStatVal: { fontSize: theme.font.body, fontWeight: '800', color: theme.color.text },
  shopStatLbl: { fontSize: theme.font.tiny, color: theme.color.textFaint },
  premiumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: theme.space.sm, borderTopWidth: 1, borderTopColor: theme.color.border, paddingTop: theme.space.sm },
  premiumLabel: { flex: 1, fontSize: theme.font.small, color: theme.color.textMuted, fontWeight: '600' },
  campaignCount: { fontSize: theme.font.tiny, color: theme.color.accent, fontWeight: '700' },

  backBtn: { alignSelf: 'flex-start', paddingVertical: theme.space.xs },
  backBtnText: { color: theme.color.accent, fontWeight: '700', fontSize: theme.font.body },
  createBtn: { backgroundColor: theme.color.primary, borderRadius: theme.radius.md, paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg },
  createBtnText: { color: '#fff', fontWeight: '800', fontSize: theme.font.small },

  campaignCard: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, padding: theme.space.lg, gap: 4 },
  campaignHead: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  statusBadge: { borderRadius: theme.radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeText: { color: '#fff', fontWeight: '800', fontSize: 10, letterSpacing: 0.5 },
  servingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#059669' },
  campaignCpc: { fontSize: theme.font.body, fontWeight: '800', color: theme.color.text },
  campaignMeta: { fontSize: theme.font.small, color: theme.color.textMuted },
  iconBtn: { padding: theme.space.xs },

  empty: { alignItems: 'center', padding: theme.space.xxxl },
  emptyText: { color: theme.color.textMuted, fontSize: theme.font.body },
});

const f = StyleSheet.create({
  card: { backgroundColor: theme.color.surfaceAlt, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.borderStrong, padding: theme.space.lg, gap: theme.space.md },
  heading: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.text },
  row2: { flexDirection: 'row', gap: theme.space.lg },
  col: { flex: 1, gap: theme.space.xs },
  label: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  input: { borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md, padding: theme.space.md, fontSize: theme.font.body, color: theme.color.text, backgroundColor: theme.color.surface },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.space.md },
  cancelBtn: { paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  cancelBtnText: { color: theme.color.textMuted, fontWeight: '700' },
  saveBtn: { paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl, borderRadius: theme.radius.md, backgroundColor: theme.color.primary, minWidth: 120, alignItems: 'center' },
  saveBtnDim: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: theme.font.body },
});
