import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '@nearbaz/api-client';
import { api } from '../api';
import { formatRupees, theme } from '../theme';

/**
 * GstScreen — NearBaz's GST back office. Four sections:
 *  1. Config card — NearBaz's GST identity (home state drives CGST/SGST vs IGST).
 *  2. Generate invoices — create monthly tax invoices for a period.
 *  3. Invoices list — issued/draft tax invoices with the tax split.
 *  4. Reports — GST summary totals + the GSTR-1 B2B export as copyable JSON.
 *
 * Admin/owner only — a non-admin token yields 403, surfaced as a "not an admin"
 * notice like the other admin screens.
 */

interface GstConfig {
  legalName: string;
  gstin: string;
  stateCode: string;
  address?: string | null;
  invoicePrefix?: string | null;
}

interface TaxInvoice {
  invoiceNumber: string;
  shopId: string;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  status: string;
  issuedAt: string | null;
  periodStart: string;
  periodEnd: string;
}

interface GstSummary {
  totals: {
    taxableValuePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    totalGstPaise: number;
    invoiceCount: number;
  };
  perShop?: Array<{
    shopId: string;
    shopName?: string | null;
    shopGstin?: string | null;
    taxableValuePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    totalGstPaise: number;
    invoiceCount: number;
  }>;
}

/** First and last day of the current month as ISO (YYYY-MM-DD) strings. */
function currentMonthRange(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(new Date(y, m, 1)), end: iso(new Date(y, m + 1, 0)) };
}

/**
 * The summary shape isn't strictly guaranteed, so read totals defensively —
 * some fields may live at the root or under `totals`. Returns a normalized view.
 */
function readTotals(s: GstSummary | null): GstSummary['totals'] | null {
  if (!s) return null;
  const raw = (s.totals ?? (s as unknown as GstSummary['totals'])) as
    | Partial<GstSummary['totals']>
    | undefined;
  if (!raw) return null;
  return {
    taxableValuePaise: raw.taxableValuePaise ?? 0,
    cgstPaise: raw.cgstPaise ?? 0,
    sgstPaise: raw.sgstPaise ?? 0,
    igstPaise: raw.igstPaise ?? 0,
    totalGstPaise:
      raw.totalGstPaise ??
      (raw.cgstPaise ?? 0) + (raw.sgstPaise ?? 0) + (raw.igstPaise ?? 0),
    invoiceCount: raw.invoiceCount ?? 0,
  };
}

/** GSTR-1 export shape returned by the API (B2B rows + no-GSTIN bucket). */
interface Gstr1Export {
  periodStart: string;
  periodEnd: string;
  b2b: Array<{
    gstin: string; invoiceNumber: string; invoiceDate: string;
    taxableValuePaise: number; rate: number;
    cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number;
  }>;
  b2cUnregistered?: Array<{
    shopId: string; invoiceNumber: string; invoiceDate: string;
    taxableValuePaise: number; rate: number;
    cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number;
  }>;
  missingGstinCount?: number;
  totals: {
    invoiceCount: number; taxableValuePaise: number;
    cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number;
  };
}

const rupees = (paise: number) => (paise / 100).toFixed(2);

/** Serialize rows to a CSV string; escapes commas/quotes/newlines per RFC 4180. */
function toCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}

/** Trigger a browser download of `csv` as `filename` (web only; no-op elsewhere). */
function downloadCsv(filename: string, csv: string) {
  if (typeof document === 'undefined') return;
  // Prepend a BOM so Excel opens UTF-8 CSV with rupee symbols correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function GstScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Config
  const [config, setConfig] = useState<GstConfig | null>(null);
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [address, setAddress] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);

  // Period (shared by generate + reports)
  const initial = currentMonthRange();
  const [periodStart, setPeriodStart] = useState(initial.start);
  const [periodEnd, setPeriodEnd] = useState(initial.end);

  // Invoices
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [generating, setGenerating] = useState(false);

  // Reports
  const [summary, setSummary] = useState<GstSummary | null>(null);
  const [gstr1, setGstr1] = useState<unknown>(null);
  const [reportBusy, setReportBusy] = useState<null | 'summary' | 'gstr1'>(null);

  function flash(msg: string) {
    setBanner(msg);
    setTimeout(() => setBanner(null), 3500);
  }

  function applyConfig(c: GstConfig | null) {
    setConfig(c);
    setLegalName(c?.legalName ?? '');
    setGstin(c?.gstin ?? '');
    setStateCode(c?.stateCode ?? '');
    setAddress(c?.address ?? '');
    setInvoicePrefix(c?.invoicePrefix ?? '');
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const [cfg, inv] = await Promise.all([
        api.gstConfig() as Promise<GstConfig | null>,
        api.gstListInvoices() as Promise<TaxInvoice[]>,
      ]);
      applyConfig(cfg);
      setInvoices(inv ?? []);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  async function saveConfig() {
    if (!legalName.trim() || !gstin.trim() || !stateCode.trim()) {
      flash('Legal name, GSTIN and state code are required.');
      return;
    }
    setSavingConfig(true);
    try {
      await api.gstUpsertConfig({
        legalName: legalName.trim(),
        gstin: gstin.trim(),
        stateCode: stateCode.trim(),
        address: address.trim() || undefined,
        invoicePrefix: invoicePrefix.trim() || undefined,
      });
      const cfg = (await api.gstConfig()) as GstConfig | null;
      applyConfig(cfg);
      flash('GST config saved.');
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) flash('Access denied — admin/owner only.');
      else flash(`Failed to save config: ${(e as Error).message}`);
    } finally {
      setSavingConfig(false);
    }
  }

  async function generate() {
    if (!periodStart.trim() || !periodEnd.trim()) {
      flash('Enter a period start and end date.');
      return;
    }
    setGenerating(true);
    try {
      const created = (await api.gstGenerateInvoices(periodStart.trim(), periodEnd.trim())) as unknown[];
      flash(`${created?.length ?? 0} invoice(s) generated.`);
      const inv = (await api.gstListInvoices()) as TaxInvoice[];
      setInvoices(inv ?? []);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) flash('Access denied — admin/owner only.');
      else flash(`Generate failed: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }

  async function fetchSummary() {
    setReportBusy('summary');
    try {
      const s = (await api.gstSummary(periodStart.trim(), periodEnd.trim())) as GstSummary;
      setSummary(s);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) flash('Access denied — admin/owner only.');
      else flash(`Summary failed: ${(e as Error).message}`);
    } finally {
      setReportBusy(null);
    }
  }

  async function fetchGstr1() {
    setReportBusy('gstr1');
    try {
      const g = await api.gstGstr1(periodStart.trim(), periodEnd.trim());
      setGstr1(g);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) flash('Access denied — admin/owner only.');
      else flash(`GSTR-1 failed: ${(e as Error).message}`);
    } finally {
      setReportBusy(null);
    }
  }

  // Export the fetched summary (per-shop + totals) as a CSV that opens in Excel.
  function exportSummaryCsv() {
    const t = readTotals(summary);
    if (!t) { flash('Fetch summary first.'); return; }
    const headers = ['Shop', 'GSTIN', 'Invoices', 'Taxable ₹', 'CGST ₹', 'SGST ₹', 'IGST ₹', 'Total GST ₹'];
    const rows: (string | number)[][] = (summary?.perShop ?? []).map((r) => [
      r.shopName ?? r.shopId,
      (r as { shopGstin?: string | null }).shopGstin ?? '—',
      r.invoiceCount,
      rupees(r.taxableValuePaise), rupees(r.cgstPaise), rupees(r.sgstPaise), rupees(r.igstPaise), rupees(r.totalGstPaise),
    ]);
    rows.push([
      'TOTAL', '', t.invoiceCount,
      rupees(t.taxableValuePaise), rupees(t.cgstPaise), rupees(t.sgstPaise), rupees(t.igstPaise), rupees(t.totalGstPaise),
    ]);
    downloadCsv(`gst-summary_${periodStart}_${periodEnd}.csv`, toCsv(headers, rows));
  }

  // Export the fetched GSTR-1 (B2B rows + no-GSTIN rows) as an Excel-openable CSV.
  function exportGstr1Csv() {
    const g = gstr1 as Gstr1Export | null;
    if (!g) { flash('Fetch GSTR-1 export first.'); return; }
    const headers = ['Section', 'GSTIN', 'Invoice No', 'Invoice Date', 'Rate %', 'Taxable ₹', 'CGST ₹', 'SGST ₹', 'IGST ₹', 'Total ₹'];
    const rows: (string | number)[][] = [];
    for (const r of g.b2b ?? []) {
      rows.push(['B2B', r.gstin, r.invoiceNumber, r.invoiceDate.slice(0, 10), r.rate,
        rupees(r.taxableValuePaise), rupees(r.cgstPaise), rupees(r.sgstPaise), rupees(r.igstPaise), rupees(r.totalPaise)]);
    }
    for (const r of g.b2cUnregistered ?? []) {
      rows.push(['B2C (no GSTIN)', '—', r.invoiceNumber, r.invoiceDate.slice(0, 10), r.rate,
        rupees(r.taxableValuePaise), rupees(r.cgstPaise), rupees(r.sgstPaise), rupees(r.igstPaise), rupees(r.totalPaise)]);
    }
    downloadCsv(`gstr1_${periodStart}_${periodEnd}.csv`, toCsv(headers, rows));
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.color.accent} size="large" />
      </View>
    );
  }

  if (forbidden) {
    return (
      <View style={styles.center}>
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Access denied</Text>
          <Text style={styles.noticeBody}>
            You need an admin or owner account to manage GST.
          </Text>
        </View>
      </View>
    );
  }

  const totals = readTotals(summary);

  return (
    <View style={styles.wrap}>
      {banner ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{banner}</Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View style={styles.pageHeader}>
          <View>
            <Text style={styles.h1}>GST</Text>
            <Text style={styles.sub}>
              Tax identity, monthly invoices & GSTR-1 export
            </Text>
          </View>
          <Pressable style={styles.refreshBtn} onPress={() => load()}>
            <Text style={styles.refreshText}>Refresh</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* 1. Config card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>NearBaz GST identity</Text>
          <Text style={styles.cardHint}>
            Home state used to split CGST/SGST (intra-state) vs IGST (inter-state).
            {config ? '' : ' Not configured yet — fill this in first.'}
          </Text>

          <Field label="Legal name" value={legalName} onChangeText={setLegalName} placeholder="NearBaz Pvt Ltd" />
          <Field
            label="GSTIN"
            value={gstin}
            onChangeText={setGstin}
            placeholder="22AAAAA0000A1Z5"
            autoCapitalize="characters"
          />
          <Field
            label="State code"
            value={stateCode}
            onChangeText={setStateCode}
            placeholder="e.g. 27 (Maharashtra)"
          />
          <Field
            label="Address"
            value={address}
            onChangeText={setAddress}
            placeholder="Registered address"
            multiline
          />
          <Field
            label="Invoice prefix"
            value={invoicePrefix}
            onChangeText={setInvoicePrefix}
            placeholder="e.g. PW"
            autoCapitalize="characters"
          />

          <Pressable
            style={[styles.primaryBtn, savingConfig && styles.btnDisabled]}
            onPress={saveConfig}
            disabled={savingConfig}
          >
            {savingConfig ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>{config ? 'Update config' : 'Save config'}</Text>
            )}
          </Pressable>
        </View>

        {/* Period selector (shared by generate + reports) */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Period</Text>
          <Text style={styles.cardHint}>ISO dates (YYYY-MM-DD). Defaults to the current month.</Text>
          <View style={styles.dateRow}>
            <Field label="Period start" value={periodStart} onChangeText={setPeriodStart} placeholder="2026-08-01" style={{ flex: 1 }} />
            <Field label="Period end" value={periodEnd} onChangeText={setPeriodEnd} placeholder="2026-08-31" style={{ flex: 1 }} />
          </View>
          <Pressable
            style={[styles.primaryBtn, generating && styles.btnDisabled]}
            onPress={generate}
            disabled={generating}
          >
            {generating ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>Generate invoices for period</Text>
            )}
          </Pressable>
        </View>

        {/* 3. Invoices list */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tax invoices ({invoices.length})</Text>
          {invoices.length === 0 ? (
            <Text style={styles.cardHint}>No invoices yet. Generate them for a period above.</Text>
          ) : (
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHead]}>
                <Text style={[styles.col, styles.colInv, styles.th]}>Invoice</Text>
                <Text style={[styles.col, styles.colTax, styles.th]}>Taxable</Text>
                <Text style={[styles.col, styles.colTax, styles.th]}>CGST</Text>
                <Text style={[styles.col, styles.colTax, styles.th]}>SGST</Text>
                <Text style={[styles.col, styles.colTax, styles.th]}>IGST</Text>
                <Text style={[styles.col, styles.colTax, styles.th]}>Total</Text>
                <Text style={[styles.col, styles.colStatus, styles.th]}>Status</Text>
              </View>
              {invoices.map((inv, i) => (
                <View key={inv.invoiceNumber} style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}>
                  <View style={[styles.col, styles.colInv]}>
                    <Text style={styles.invNumber} numberOfLines={1}>{inv.invoiceNumber}</Text>
                    <Text style={styles.invShop} numberOfLines={1}>Shop {inv.shopId}</Text>
                  </View>
                  <Text style={[styles.col, styles.colTax, styles.cellNum]}>{formatRupees(inv.taxableValuePaise)}</Text>
                  <Text style={[styles.col, styles.colTax, styles.cellNum]}>{formatRupees(inv.cgstPaise)}</Text>
                  <Text style={[styles.col, styles.colTax, styles.cellNum]}>{formatRupees(inv.sgstPaise)}</Text>
                  <Text style={[styles.col, styles.colTax, styles.cellNum]}>{formatRupees(inv.igstPaise)}</Text>
                  <Text style={[styles.col, styles.colTax, styles.cellNum, { fontWeight: '800' }]}>{formatRupees(inv.totalPaise)}</Text>
                  <View style={[styles.col, styles.colStatus]}>
                    <View style={styles.statusBadge}>
                      <Text style={styles.statusBadgeText}>{inv.status}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* 4. Reports */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Reports</Text>
          <Text style={styles.cardHint}>Summary totals and the GSTR-1 B2B export for the period above.</Text>
          <View style={styles.reportActions}>
            <Pressable
              style={[styles.secondaryBtn, reportBusy === 'summary' && styles.btnDisabled]}
              onPress={fetchSummary}
              disabled={reportBusy !== null}
            >
              {reportBusy === 'summary' ? (
                <ActivityIndicator color={theme.color.text} size="small" />
              ) : (
                <Text style={styles.secondaryBtnText}>Fetch summary</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, reportBusy === 'gstr1' && styles.btnDisabled]}
              onPress={fetchGstr1}
              disabled={reportBusy !== null}
            >
              {reportBusy === 'gstr1' ? (
                <ActivityIndicator color={theme.color.text} size="small" />
              ) : (
                <Text style={styles.secondaryBtnText}>Fetch GSTR-1 export</Text>
              )}
            </Pressable>
            {summary ? (
              <Pressable style={styles.secondaryBtn} onPress={exportSummaryCsv}>
                <Text style={styles.secondaryBtnText}>⬇ Summary Excel (CSV)</Text>
              </Pressable>
            ) : null}
            {gstr1 !== null ? (
              <Pressable style={styles.secondaryBtn} onPress={exportGstr1Csv}>
                <Text style={styles.secondaryBtnText}>⬇ GSTR-1 Excel (CSV)</Text>
              </Pressable>
            ) : null}
          </View>

          {totals ? (
            <View style={styles.summaryBox}>
              <View style={styles.summaryStats}>
                <SummaryStat label="Total taxable" value={formatRupees(totals.taxableValuePaise)} />
                <SummaryStat label="CGST" value={formatRupees(totals.cgstPaise)} />
                <SummaryStat label="SGST" value={formatRupees(totals.sgstPaise)} />
                <SummaryStat label="IGST" value={formatRupees(totals.igstPaise)} />
                <SummaryStat label="Total GST" value={formatRupees(totals.totalGstPaise)} />
                <SummaryStat label="Invoices" value={String(totals.invoiceCount)} />
              </View>

              {summary?.perShop && summary.perShop.length > 0 ? (
                <View style={styles.perShopBox}>
                  <Text style={styles.perShopTitle}>Per shop</Text>
                  {summary.perShop.map((row) => (
                    <View key={row.shopId} style={styles.perShopRow}>
                      <Text style={styles.perShopName} numberOfLines={1}>
                        {row.shopName ?? `Shop ${row.shopId}`}
                      </Text>
                      <Text style={styles.perShopMeta}>
                        {formatRupees(row.taxableValuePaise)} taxable · {formatRupees(row.totalGstPaise)} GST · {row.invoiceCount} inv
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {gstr1 !== null ? (
            <View style={styles.jsonBox}>
              <Text style={styles.jsonTitle}>GSTR-1 B2B export (portal-uploadable)</Text>
              {(gstr1 as Gstr1Export).missingGstinCount ? (
                <Text style={styles.gstinWarn}>
                  ⚠ {(gstr1 as Gstr1Export).missingGstinCount} invoice(s) from shops without a GSTIN are listed
                  separately as B2C (unregistered) — they are NOT included in the B2B upload.
                </Text>
              ) : null}
              <ScrollView style={styles.jsonScroll} horizontal={false}>
                <TextInput
                  style={styles.jsonText}
                  value={JSON.stringify(gstr1, null, 2)}
                  editable={false}
                  multiline
                  scrollEnabled={false}
                />
              </ScrollView>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize,
  multiline,
  style,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  autoCapitalize?: 'none' | 'characters' | 'words' | 'sentences';
  multiline?: boolean;
  style?: object;
}) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.textFaint}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        autoCorrect={false}
        multiline={multiline}
      />
    </View>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryStatLabel}>{label}</Text>
      <Text style={styles.summaryStatValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { padding: theme.space.xl, gap: theme.space.lg, paddingBottom: theme.space.xxxl, maxWidth: theme.maxContentWidth },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },

  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  h1: { fontSize: theme.font.h1, fontWeight: '800', color: theme.color.text },
  sub: { fontSize: theme.font.body, color: theme.color.textMuted, marginTop: 2 },
  refreshBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.borderStrong, backgroundColor: theme.color.surface },
  refreshText: { color: theme.color.text, fontWeight: '600', fontSize: theme.font.small },

  card: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, padding: theme.space.lg, gap: theme.space.md, ...theme.shadow.card },
  cardTitle: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  cardHint: { fontSize: theme.font.small, color: theme.color.textMuted, lineHeight: 19 },

  field: { gap: theme.space.xs },
  fieldLabel: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  input: {
    borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md,
    padding: theme.space.md, fontSize: theme.font.body, color: theme.color.text,
    backgroundColor: theme.color.surfaceAlt,
  },
  inputMultiline: { minHeight: 64, textAlignVertical: 'top' },
  dateRow: { flexDirection: 'row', gap: theme.space.md },

  primaryBtn: {
    alignSelf: 'flex-start', backgroundColor: theme.color.primary, borderRadius: theme.radius.md,
    paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl, alignItems: 'center', minWidth: 180,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.body },
  secondaryBtn: {
    backgroundColor: theme.color.surfaceAlt, borderWidth: 1, borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.md, paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, minWidth: 150, alignItems: 'center',
  },
  secondaryBtnText: { color: theme.color.text, fontWeight: '700', fontSize: theme.font.small },
  btnDisabled: { opacity: 0.6 },

  // Invoices table
  table: { borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.md, overflow: 'hidden' },
  tableHead: { backgroundColor: theme.color.surfaceAlt },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  tableRowAlt: { backgroundColor: '#FAFBFC' },
  th: { fontSize: theme.font.tiny, fontWeight: '800', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  col: { paddingHorizontal: 4 },
  colInv: { flex: 2 },
  colTax: { flex: 1.2, textAlign: 'right' },
  colStatus: { flex: 1, alignItems: 'flex-end' },
  cellNum: { fontSize: theme.font.small, color: theme.color.text },
  invNumber: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  invShop: { fontSize: theme.font.tiny, color: theme.color.textMuted, marginTop: 1 },
  statusBadge: { alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: theme.space.sm, borderRadius: theme.radius.pill, backgroundColor: theme.color.infoBg },
  statusBadgeText: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.info },

  // Reports
  reportActions: { flexDirection: 'row', gap: theme.space.sm, flexWrap: 'wrap' },
  summaryBox: { gap: theme.space.md, paddingTop: theme.space.sm },
  summaryStats: { flexDirection: 'row', gap: theme.space.xl, flexWrap: 'wrap', paddingVertical: theme.space.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.color.border },
  summaryStat: { gap: 2 },
  summaryStatLabel: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  summaryStatValue: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  perShopBox: { gap: theme.space.xs },
  perShopTitle: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  perShopRow: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.space.md, paddingVertical: 2 },
  perShopName: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.text, flex: 1 },
  perShopMeta: { fontSize: theme.font.small, color: theme.color.textMuted },

  jsonBox: { gap: theme.space.sm, marginTop: theme.space.sm },
  jsonTitle: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  gstinWarn: { fontSize: theme.font.small, color: '#B45309', backgroundColor: '#FEF3C7', borderRadius: theme.radius.sm, padding: theme.space.sm, marginTop: theme.space.sm, lineHeight: 18 },
  jsonScroll: { maxHeight: 320, borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.md, backgroundColor: theme.color.primaryDark },
  jsonText: {
    fontSize: theme.font.small, color: '#E2E8F0', padding: theme.space.md,
    fontFamily: 'monospace',
  },

  error: { color: theme.color.critical, fontSize: theme.font.body },
  banner: { backgroundColor: theme.color.primary, paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl },
  bannerText: { color: '#fff', fontWeight: '600', fontSize: theme.font.small },
  notice: { maxWidth: 420, padding: theme.space.xl, borderRadius: theme.radius.lg, backgroundColor: theme.color.criticalBg, borderWidth: 1, borderColor: '#FCA5A5', gap: theme.space.sm },
  noticeTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.critical },
  noticeBody: { fontSize: theme.font.body, color: theme.color.text, lineHeight: 21 },
});
