import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { VerificationStatus } from '@passwaala/shared';
import { api } from '../api';
import { formatRupees, placeholderImage, theme } from '../theme';
import { Banner, Button, SectionTitle } from '../ui';
import { verificationMeta } from '../status';
import { useLang } from '../i18n/LanguageContext';
import type { MyShop } from '../types';

interface StatWindow {
  orders: number;
  delivered: number;
  valuePaise: number;
}

interface ShopStats {
  today: StatWindow;
  last7Days: StatWindow;
  thisMonth: StatWindow;
  activeOrders: number;
}

interface ProductSummary {
  stock: number;
  available: boolean;
}

type StatRange = 'today' | 'last7Days' | 'thisMonth';

export function DashboardScreen({
  shop,
  onShopChange,
  onGoToKyc,
  onGoToOrders,
  onGoToProducts,
}: {
  shop: MyShop;
  onShopChange: (shop: MyShop) => void;
  onGoToKyc: () => void;
  onGoToOrders: () => void;
  onGoToProducts: () => void;
}) {
  const { t } = useLang();
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<ShopStats | null>(null);
  const [totalProducts, setTotalProducts] = useState<number | null>(null);
  const [outOfStock, setOutOfStock] = useState<number | null>(null);
  const [range, setRange] = useState<StatRange>('today');

  const RANGES: { key: StatRange; label: string }[] = [
    { key: 'today', label: t.dashboard.rangeToday },
    { key: 'last7Days', label: t.dashboard.range7Days },
    { key: 'thisMonth', label: t.dashboard.rangeThisMonth },
  ];

  const isApproved = shop.verificationStatus === VerificationStatus.APPROVED;
  const meta = verificationMeta(shop.verificationStatus, t);

  const loadData = useCallback(async () => {
    try {
      const [statsRes, productsRes] = await Promise.all([
        api.shopStats() as Promise<ShopStats>,
        api.myProducts() as Promise<ProductSummary[]>,
      ]);
      setStats(statsRes);
      setTotalProducts(productsRes.length);
      setOutOfStock(productsRes.filter((p) => p.stock === 0 || !p.available).length);
    } catch {
      // Non-fatal — dashboard still renders with dashes.
    }
  }, []);

  useEffect(() => {
    setStats(null);
    setTotalProducts(null);
    setOutOfStock(null);
    loadData();
  }, [loadData, shop.id]);

  const window = stats ? stats[range] : null;

  async function toggleOpen(next: boolean) {
    if (!isApproved) return;
    setToggling(true);
    setError(null);
    try {
      const res = await api.setStoreOpen(next);
      onShopChange({ ...shop, isOpen: (res as { isOpen: boolean }).isOpen });
    } catch (e) {
      setError((e as Error).message || t.dashboard.statusDefaultError);
    } finally {
      setToggling(false);
    }
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.root}>

      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>
            Hello <Text style={styles.greetingBold}>{shop.name},</Text>
          </Text>
          <Text style={styles.greetingSub}>Here's how your shop's doing</Text>
        </View>
        <Image
          source={{ uri: shop.storefrontPhotoUrl || placeholderImage(shop.id || shop.name, 80, 80) }}
          style={styles.shopLogo}
        />
      </View>

      {/* Time period selector + status badge row */}
      <View style={styles.periodRow}>
        <View style={styles.periodPicker}>
          <Text style={styles.periodText}>
            {RANGES.find((r) => r.key === range)?.label ?? t.dashboard.rangeToday}
          </Text>
          <View style={styles.periodArrow}>
            {RANGES.map((r) => (
              <Pressable
                key={r.key}
                onPress={() => setRange(r.key)}
                style={[styles.periodOption, r.key === range && styles.periodOptionActive]}
              >
                <Text style={[styles.periodOptionText, r.key === range && styles.periodOptionTextActive]}>
                  {r.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.statusBadgeWrap}>
          <View style={[styles.statusDot, { backgroundColor: isApproved && shop.isOpen ? theme.color.primary : theme.color.borderStrong }]} />
          <Text style={styles.statusBadgeText}>{meta.label}</Text>
        </View>
      </View>

      {/* 2×2 stat grid */}
      <View style={styles.grid}>
        <StatCard
          icon=""
          label="Revenue"
          sub="Total revenue"
          value={window ? formatRupees(window.valuePaise) : '—'}
          iconBg={theme.color.primarySoft}
        />
        <StatCard
          icon=""
          label="Sales"
          sub="Total Sales"
          value={window ? String(window.delivered) : '—'}
          iconBg={theme.color.primarySoft}
        />
        <StatCard
          icon=""
          label="Orders"
          sub="Total orders"
          value={window ? String(window.orders) : '—'}
          iconBg={theme.color.primarySoft}
        />
        <StatCard
          icon=""
          label="Active"
          sub="Live orders"
          value={stats ? String(stats.activeOrders) : '—'}
          iconBg={theme.color.accentSoft}
          accent
        />
      </View>

      {/* Products row */}
      <View style={styles.grid}>
        <ProductCard
          icon=""
          label="Total Products"
          value={totalProducts !== null ? String(totalProducts) : '—'}
          iconBg={theme.color.primarySoft}
        />
        <ProductCard
          icon=""
          label="Out of stock"
          value={outOfStock !== null ? String(outOfStock) : '—'}
          iconBg={theme.color.dangerSoft}
          danger={outOfStock !== null && outOfStock > 0}
        />
      </View>

      {/* Online / Offline toggle */}
      <View style={[styles.toggleCard, theme.shadow.sm]}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleTitle}>{t.dashboard.storeStatus}</Text>
            <Text style={styles.toggleState}>
              {isApproved
                ? shop.isOpen
                  ? t.dashboard.online
                  : t.dashboard.offline
                : t.dashboard.notLive}
            </Text>
          </View>
          {toggling ? (
            <ActivityIndicator color={theme.color.primary} />
          ) : (
            <Switch
              value={isApproved && shop.isOpen}
              onValueChange={toggleOpen}
              disabled={!isApproved}
              trackColor={{ false: theme.color.borderStrong, true: theme.color.primary }}
              thumbColor={theme.color.white}
            />
          )}
        </View>
        {!isApproved && (
          <Text style={styles.toggleHint}>{t.dashboard.notApprovedHint}</Text>
        )}
        {error && (
          <Banner tone="danger" title={t.dashboard.statusUpdateFailed} message={error} />
        )}
      </View>

      {/* KYC banners */}
      {shop.verificationStatus === VerificationStatus.DRAFT && (
        <Banner
          tone="warning"
          title={t.dashboard.draftTitle}
          message={t.dashboard.draftBody}
          action={<Button label={t.dashboard.startKyc} small variant="accent" onPress={onGoToKyc} />}
        />
      )}
      {shop.verificationStatus === VerificationStatus.REJECTED && (
        <Banner
          tone="danger"
          title={t.dashboard.rejectedTitle}
          message={t.dashboard.rejectedBody}
          action={<Button label={t.dashboard.resubmit} small variant="danger" onPress={onGoToKyc} />}
        />
      )}
      {shop.verificationStatus === VerificationStatus.PENDING_REVIEW && (
        <Banner tone="info" title={t.dashboard.reviewTitle} message={t.dashboard.reviewBody} />
      )}
      {shop.verificationStatus === VerificationStatus.SUSPENDED && (
        <Banner tone="danger" title={t.dashboard.suspendedTitle} message={t.dashboard.suspendedBody} />
      )}

      {/* Quick actions */}
      <SectionTitle style={{ marginTop: theme.space.xs }}>{t.dashboard.quickActions}</SectionTitle>
      <View style={styles.grid}>
        <QuickAction label={t.dashboard.quickOrders} sub={t.dashboard.quickOrdersSub} onPress={onGoToOrders} />
        <QuickAction label={t.dashboard.quickProducts} sub={t.dashboard.quickProductsSub} onPress={onGoToProducts} />
      </View>

    </ScrollView>
  );
}

function StatCard({
  icon,
  label,
  sub,
  value,
  iconBg,
  accent = false,
}: {
  icon: string;
  label: string;
  sub: string;
  value: string;
  iconBg: string;
  accent?: boolean;
}) {
  return (
    <View style={[styles.statCard, theme.shadow.sm]}>
      <View style={styles.statCardTop}>
        <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
          <Text style={styles.iconEmoji}>{icon}</Text>
        </View>
        <Pressable style={styles.arrowBtn}>
          <Text style={[styles.arrowText, accent && { color: theme.color.accent }]}>↗</Text>
        </Pressable>
      </View>
      <Text style={styles.statSub}>{sub}</Text>
      <Text style={[styles.statValue, accent && { color: theme.color.accent }]}>{value}</Text>
    </View>
  );
}

function ProductCard({
  icon,
  label,
  value,
  iconBg,
  danger = false,
}: {
  icon: string;
  label: string;
  value: string;
  iconBg: string;
  danger?: boolean;
}) {
  return (
    <View style={[styles.productCard, theme.shadow.sm]}>
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
        <Text style={styles.iconEmoji}>{icon}</Text>
      </View>
      <Text style={styles.productLabel}>{label}</Text>
      <Text style={[styles.productValue, danger && { color: theme.color.danger }]}>{value}</Text>
    </View>
  );
}

function QuickAction({ label, sub, onPress }: { label: string; sub: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.quickCard, theme.shadow.sm, pressed && { opacity: 0.6 }]}
    >
      <Text style={styles.quickLabel}>{label}</Text>
      <Text style={styles.quickSub}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: theme.color.bg },
  root: { gap: theme.space.md, padding: theme.space.lg, paddingBottom: theme.space.xxl },

  // Header
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md, marginBottom: theme.space.xs },
  greeting: { fontSize: theme.font.h3, color: theme.color.text },
  greetingBold: { fontWeight: '900', color: theme.color.text },
  greetingSub: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  shopLogo: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.pill,
    borderWidth: 2,
    borderColor: theme.color.primary,
    backgroundColor: theme.color.surfaceAlt,
  },

  // Period selector row
  periodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  periodPicker: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
  },
  periodText: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  periodArrow: { flexDirection: 'row', gap: 4 },
  periodOption: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.radius.sm,
  },
  periodOptionActive: { backgroundColor: theme.color.primarySoft },
  periodOptionText: { fontSize: theme.font.tiny, color: theme.color.textMuted, fontWeight: '600' },
  periodOptionTextActive: { color: theme.color.primary, fontWeight: '800' },
  statusBadgeWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusBadgeText: { fontSize: theme.font.small, color: theme.color.textMuted, fontWeight: '600' },

  // Grid
  grid: { flexDirection: 'row', gap: theme.space.md },

  // Stat card (2×2 grid)
  statCard: {
    flex: 1,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    gap: 4,
  },
  statCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  iconWrap: { width: 32, height: 32, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
  iconEmoji: { fontSize: 16 },
  arrowBtn: { padding: 2 },
  arrowText: { fontSize: 16, color: theme.color.text, fontWeight: '700' },
  statSub: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  statValue: { fontSize: theme.font.h3, fontWeight: '900', color: theme.color.text },

  // Product card (1×2 row)
  productCard: {
    flex: 1,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    gap: 6,
  },
  productLabel: { fontSize: theme.font.small, color: theme.color.text, fontWeight: '700' },
  productValue: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text },

  // Toggle card
  toggleCard: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    gap: theme.space.sm,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
  toggleTitle: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  toggleState: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  toggleHint: { fontSize: theme.font.small, color: theme.color.warning },

  // Quick action cards
  quickCard: {
    flex: 1,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    gap: 2,
  },
  quickLabel: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.primary },
  quickSub: { fontSize: theme.font.small, color: theme.color.textMuted },
});
