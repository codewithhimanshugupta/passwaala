import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthExpiredError } from '@passwaala/api-client';
import type { VerificationStatus } from '@passwaala/shared';
import { LoginScreen } from './src/screens/LoginScreen';
import { SignupScreen } from './src/screens/SignupScreen';
import { RegisterShopScreen } from './src/screens/RegisterShopScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { OrderFeedScreen } from './src/screens/OrderFeedScreen';
import { ProductsScreen } from './src/screens/ProductsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { LedgerScreen } from './src/screens/LedgerScreen';
import { api, hasSavedToken, logout, onAuthExpired } from './src/api';
import { connectSocket, disconnectSocket, reconnectSocket } from './src/socket';
import { formatRupees, theme } from './src/theme';
import { Badge } from './src/ui';
import { TabIcon } from './src/TabIcon';
import { verificationMeta } from './src/status';
import { useNewOrderAlerts } from './src/useNewOrderAlerts';
import { unlockAudio } from './src/sound';
import { LanguageProvider, useLang } from './src/i18n/LanguageContext';
import type { Strings } from './src/i18n/strings';
import type { MyShop, MyShopSummary, FeedOrder } from './src/types';

/** True for a 401 / expired-session error (either the typed error or status). */
function isAuthExpired(err: unknown): boolean {
  return err instanceof AuthExpiredError || (err as { status?: number })?.status === 401;
}

/**
 * PassWaala shopkeeper app root. Flow: login (OTP) → resolve shop (myShop 200 =
 * has a shop; 403/404 = must register) → main app with a hand-rolled bottom tab
 * bar (Home / Orders / Products / Settings / Ledger). The session token persists
 * (src/api.ts) so a refresh/restart keeps the shopkeeper logged in.
 */
type Stage = 'login' | 'resolving' | 'register' | 'app';
type Tab = 'home' | 'orders' | 'products' | 'settings' | 'ledger';
/** 'all' = overview of all shops; a shop id = that shop's single-shop view */
type ViewContext = 'all' | string;

function tabList(t: Strings): { key: Tab; label: string }[] {
  return [
    { key: 'home', label: t.tabs.home },
    { key: 'orders', label: t.tabs.orders },
    { key: 'products', label: t.tabs.products },
    { key: 'settings', label: t.tabs.settings },
    { key: 'ledger', label: t.tabs.ledger },
  ];
}

export default function App() {
  return (
    <LanguageProvider>
      <AppRoot />
    </LanguageProvider>
  );
}

function AppRoot() {
  const { t } = useLang();
  const [stage, setStage] = useState<Stage>(hasSavedToken() ? 'resolving' : 'login');
  const [authScreen, setAuthScreen] = useState<'login' | 'signup'>('login');
  const [shop, setShop] = useState<MyShop | null>(null);
  const [shops, setShops] = useState<MyShopSummary[]>([]);
  const [switchingShopId, setSwitchingShopId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [sessionExpired, setSessionExpired] = useState(false);
  // 'all' when the owner has >1 shop (default view on login); otherwise the active shop id.
  const [viewContext, setViewContext] = useState<ViewContext>('all');
  // One-time audio unlock: browser autoplay policy needs a user gesture before
  // the new-order beep can sound. We flip this on the first touch after login.
  const audioUnlockedRef = useRef(false);

  // App-wide new-order alerts — polls + rings on EVERY tab (not just Orders)
  // while we're signed in with a live shop.
  // Poll for new-order alerts app-wide, EXCEPT when the Orders screen is open —
  // that screen already polls the feed, so we'd be double-polling otherwise.
  const alerts = useNewOrderAlerts(stage === 'app' && shop != null && tab !== 'orders', viewContext === 'all');

  /** Unlock audio on the first user interaction (idempotent). */
  const unlockAudioOnce = useCallback(() => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;
    unlockAudio();
  }, []);

  // Once in the app, proactively ask for browser notification permission so the
  // OS popup can fire when the tab is backgrounded. No-op if already decided.
  useEffect(() => {
    if (stage === 'app' && shop && !alerts.notifyGranted) {
      void alerts.requestPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, shop]);

  // Connect the realtime socket while in the app; disconnect otherwise.
  useEffect(() => {
    if (stage === 'app') {
      connectSocket();
      return () => disconnectSocket();
    }
  }, [stage]);

  /** After login (or on startup with a saved token), check for an owned shop. */
  const resolveShop = useCallback(async () => {
    setSessionExpired(false);
    setStage('resolving');
    try {
      const myShop = (await api.myShop()) as MyShop; // 200 → has a shop
      setShop(myShop);
      setTab('home');
      setStage('app');
      // Load the owner's shop list so we can offer a picker when they own more
      // than one. Non-fatal — a single-shop owner never sees a picker anyway.
      try {
        const list = (await api.myShops()) as MyShopSummary[];
        setShops(list);
        // Default to "all shops" view when the owner has multiple shops.
        setViewContext(list.length > 1 ? 'all' : myShop.id);
      } catch {
        setShops([]);
        setViewContext(myShop.id);
      }
    } catch (err) {
      // A 401 / expired session must NOT be treated as "no shop yet" — the
      // onUnauthorized listener already routes us to login. Only a 403/404
      // (not a shopkeeper / no shop) means "go register".
      if (isAuthExpired(err)) return;
      setStage('register');
    }
  }, []);

  // On startup with a restored token, resolve straight into the app.
  useEffect(() => {
    if (hasSavedToken()) {
      resolveShop();
    }
  }, [resolveShop]);

  // Any 401 anywhere clears the token in the client; route back to login and
  // show a "session expired" note.
  useEffect(() => {
    return onAuthExpired(() => {
      setShop(null);
      setSessionExpired(true);
      setAuthScreen('login');
      setStage('login');
    });
  }, []);

  async function doLogout() {
    await logout();
    setShop(null);
    setShops([]);
    setSessionExpired(false);
    setViewContext('all');
    setAuthScreen('login');
    setStage('login');
  }

  function onShopChange(next: MyShop) {
    setShop(next);
    // Keep the picker's badges in sync with the active shop (open/verification).
    setShops((prev) =>
      prev.map((s) =>
        s.id === next.id
          ? { ...s, name: next.name, isOpen: next.isOpen, verificationStatus: next.verificationStatus, city: next.city }
          : s,
      ),
    );
  }

  /**
   * Switch the active shop: get a fresh scoped token, install it, then refetch
   * the now-active shop + dashboard data. Guarded so tapping the active shop or
   * double-tapping is a no-op.
   */
  const switchToShop = useCallback(
    async (shopId: string) => {
      if (shopId === shop?.id || switchingShopId) return;
      setSwitchingShopId(shopId);
      try {
        const { accessToken } = await api.switchShop(shopId);
        api.setToken(accessToken);
        // Token is now scoped to the new shop — reconnect the socket so it joins
        // the new shop's room and stops receiving the previous shop's events.
        reconnectSocket();
        const myShop = (await api.myShop()) as MyShop;
        setShop(myShop);
        setViewContext(myShop.id);
        if (tab !== 'settings') setTab('home');
        try {
          setShops((await api.myShops()) as MyShopSummary[]);
        } catch {
          /* keep the existing list */
        }
      } catch (err) {
        if (isAuthExpired(err)) return;
      } finally {
        setSwitchingShopId(null);
      }
    },
    [shop?.id, switchingShopId],
  );

  /**
   * Toggle open/closed for any shop by temporarily switching to its token,
   * calling setStoreOpen, then restoring the original token. Updates the
   * shops list in place — no full refetch needed.
   */
  const toggleShopOpen = useCallback(async (shopId: string, next: boolean) => {    const originalToken = api.getToken();
    try {
      const { accessToken } = await api.switchShop(shopId);
      api.setToken(accessToken);
      const res = await api.setStoreOpen(next);
      setShops((prev) => prev.map((s) => s.id === shopId ? { ...s, isOpen: res.isOpen } : s));
      // If this is also the active shop, keep it in sync.
      setShop((prev) => prev?.id === shopId ? { ...prev, isOpen: res.isOpen } : prev);
    } catch {
      // Non-fatal — the switch or toggle failed; leave state unchanged.
    } finally {
      if (originalToken) api.setToken(originalToken);
    }
  }, []);

  const withShopToken = useCallback(async (shopId: string, fn: () => Promise<void>) => {
    const originalToken = api.getToken();
    try {
      const { accessToken } = await api.switchShop(shopId);
      api.setToken(accessToken);
      await fn();
    } finally {
      if (originalToken) api.setToken(originalToken);
    }
  }, []);

  const advanceOrderForShop = useCallback(
    async (orderId: string, shopId: string, status: import('@passwaala/shared').OrderStatus, reason?: string, otpCode?: string) => {
      await withShopToken(shopId, () => api.advanceOrder(orderId, status, reason, otpCode).then(() => undefined));
    },
    [withShopToken],
  );

  function onKycSubmitted(status: VerificationStatus) {
    setShop((prev) => (prev ? { ...prev, verificationStatus: status } : prev));
    setTab('home');
  }

  return (
    <SafeAreaView style={styles.root} onStartShouldSetResponder={() => { unlockAudioOnce(); return false; }}>
      <StatusBar style="light" />
      <View style={styles.content}>
        {stage === 'login' && (
          authScreen === 'signup' ? (
            <SignupScreen
              onSignedUp={() => { setAuthScreen('login'); resolveShop(); }}
              onBackToLogin={() => setAuthScreen('login')}
            />
          ) : (
            <LoginScreen
              onLoggedIn={resolveShop}
              sessionExpired={sessionExpired}
              onSignUp={() => setAuthScreen('signup')}
            />
          )
        )}

        {stage === 'resolving' && (
          <View style={styles.center}>
            <ActivityIndicator color={theme.color.accent} size="large" />
            <Text style={styles.loadingText}>{t.app.loadingShop}</Text>
          </View>
        )}

        {stage === 'register' && (
          <>
            <TopBar title={t.app.registerShopTitle} onLogout={doLogout} logoutLabel={t.common.logout} />
            <RegisterShopScreen
              onRegistered={(newShop) => {
                setShop(newShop);
                setTab('home');
                setStage('app');
              }}
            />
          </>
        )}

        {stage === 'app' && shop && (
          <>
            <TopBar title={t.app.partner} onLogout={doLogout} logoutLabel={t.common.logout} />
            {alerts.alertOrder ? (
              <NewOrderBanner
                order={alerts.alertOrder}
                silent={alerts.alertSilent}
                t={t}
                onView={() => {
                  unlockAudioOnce();
                  setTab('orders');
                  alerts.acknowledge();
                }}
                onAcknowledge={() => {
                  unlockAudioOnce();
                  alerts.acknowledge();
                }}
              />
            ) : null}
            <View style={styles.tabContent}>
              {tab === 'home' && (
                <>
                  {shops.length > 1 ? (
                    <ShopPicker
                      shops={shops}
                      activeId={shop.id}
                      viewContext={viewContext}
                      switchingId={switchingShopId}
                      onPick={switchToShop}
                      onPickAll={() => { setViewContext('all'); setTab('home'); }}
                      t={t}
                    />
                  ) : null}
                  {viewContext === 'all' && shops.length > 1 ? (
                    <AllShopsDashboard shops={shops} onPickShop={switchToShop} onToggleOpen={toggleShopOpen} t={t} />
                  ) : (
                    <DashboardScreen
                      shop={shop}
                      onShopChange={onShopChange}
                      onGoToKyc={() => setTab('settings')}
                      onGoToOrders={() => setTab('orders')}
                      onGoToProducts={() => setTab('products')}
                    />
                  )}
                </>
              )}
              {tab === 'orders' && (
                <OrderFeedScreen
                  key={viewContext === 'all' ? 'all' : 'single'}
                  allShops={viewContext === 'all'}
                  advanceOrder={viewContext === 'all' ? advanceOrderForShop : undefined}
                  withShopToken={viewContext === 'all' ? withShopToken : undefined}
                />
              )}
              {tab === 'products' && viewContext !== 'all' && <ProductsScreen />}
              {tab === 'products' && viewContext === 'all' && (
                <View style={styles.allShopsHint}>
                  <Text style={styles.allShopsHintText}>Select a shop to manage products.</Text>
                </View>
              )}
              {tab === 'settings' && (
                <>
                  {shops.length > 1 ? (
                    <ShopPicker
                      shops={shops}
                      activeId={shop.id}
                      viewContext={viewContext}
                      switchingId={switchingShopId}
                      onPick={switchToShop}
                      onPickAll={() => { setViewContext('all'); setTab('home'); }}
                      t={t}
                    />
                  ) : null}
                  <SettingsScreen shop={shop} onShopChange={onShopChange} onKycSubmitted={onKycSubmitted} />
                </>
              )}
              {tab === 'ledger' && <LedgerScreen />}
            </View>
            <BottomTabs active={tab} onChange={setTab} t={t} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function TopBar({ title, onLogout, logoutLabel }: { title: string; onLogout: () => void; logoutLabel: string }) {
  return (
    <View style={styles.topbar}>
      <Text style={styles.brand}>{title}</Text>
      <Pressable onPress={onLogout} hitSlop={8} style={styles.logoutBtn}>
        <Text style={styles.logout}>{logoutLabel}</Text>
      </Pressable>
    </View>
  );
}

/**
 * NewOrderBanner — the app-wide loud alert shown above the tab content whenever
 * a fresh order lands, on ANY tab. Tapping the body jumps to Orders; the sound
 * (from sound.ts) loops and the device vibrates until acknowledged.
 */
function NewOrderBanner({
  order,
  silent,
  t,
  onView,
  onAcknowledge,
}: {
  order: FeedOrder;
  silent: boolean;
  t: Strings;
  onView: () => void;
  onAcknowledge: () => void;
}) {
  const total = order.adjustedTotalPaise ?? order.originalTotalPaise;
  return (
    <Pressable onPress={onView} style={styles.alertBanner}>
      <View style={styles.alertBody}>
        <Text style={styles.alertTitle}>
          {t.app.newOrder(order.id.slice(0, 8).toUpperCase(), formatRupees(total))}
        </Text>
        <Text style={styles.alertSub}>
          {silent ? t.app.tapAcknowledge : t.app.tapToView}
        </Text>
      </View>
      <Pressable onPress={onAcknowledge} style={styles.alertAck} hitSlop={8}>
        <Text style={styles.alertAckText}>{t.app.acknowledge}</Text>
      </Pressable>
    </Pressable>
  );
}

/**
 * ShopPicker — a horizontal row of the owner's shops, shown at the top of the
 * home tab only when they own more than one. The active shop is highlighted;
 * tapping another triggers a shop switch. Each chip shows the shop name + a
 * verification status badge; the one being switched to shows a spinner.
 */
function ShopPicker({
  shops,
  activeId,
  viewContext,
  switchingId,
  onPick,
  onPickAll,
  t,
}: {
  shops: MyShopSummary[];
  activeId: string;
  viewContext: ViewContext;
  switchingId: string | null;
  onPick: (shopId: string) => void;
  onPickAll: () => void;
  t: Strings;
}) {
  const allActive = viewContext === 'all';
  return (
    <View style={styles.pickerWrap}>
      <Text style={styles.pickerLabel}>{t.app.yourShops}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pickerRow}
      >
        {/* All Shops chip */}
        <Pressable
          onPress={onPickAll}
          disabled={allActive}
          style={[styles.shopChip, allActive && styles.shopChipActive]}
        >
          <View style={styles.shopChipHeader}>
            <Text style={[styles.shopChipName, allActive && styles.shopChipNameActive]} numberOfLines={1}>
              All Shops
            </Text>
          </View>
          <View style={styles.shopChipMeta}>
            <Text style={[styles.activeTag, { opacity: allActive ? 1 : 0 }]}>{t.app.active}</Text>
          </View>
        </Pressable>

        {shops.map((s) => {
          const isActive = viewContext === s.id;
          const isSwitching = s.id === switchingId;
          const meta = verificationMeta(s.verificationStatus, t);
          return (
            <Pressable
              key={s.id}
              onPress={() => onPick(s.id)}
              disabled={isActive || switchingId !== null}
              style={[styles.shopChip, isActive && styles.shopChipActive]}
            >
              <View style={styles.shopChipHeader}>
                <View style={[styles.statusDot, { backgroundColor: s.isOpen ? theme.color.success : theme.color.textFaint }]} />
                <Text style={[styles.shopChipName, isActive && styles.shopChipNameActive]} numberOfLines={1}>
                  {s.name}
                </Text>
                {isSwitching ? <ActivityIndicator size="small" color={theme.color.accent} /> : null}
              </View>
              <View style={styles.shopChipMeta}>
                <Badge label={meta.label} tone={meta.tone} />
                {isActive ? <Text style={styles.activeTag}>{t.app.active}</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * AllShopsDashboard — shown when viewContext === 'all'. Displays aggregate
 * counts (total / open / approved) and a scrollable list of all shops. Tapping
 * a shop switches to that shop's single-shop view.
 */
function AllShopsDashboard({
  shops,
  onPickShop,
  onToggleOpen,
  t,
}: {
  shops: MyShopSummary[];
  onPickShop: (id: string) => void;
  onToggleOpen: (id: string, next: boolean) => void;
  t: Strings;
}) {
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function handleToggle(id: string, next: boolean) {
    setTogglingId(id);
    await onToggleOpen(id, next);
    setTogglingId(null);
  }

  const totalShops = shops.length;
  const openShops = shops.filter((s) => s.isOpen).length;
  const approvedShops = shops.filter((s) => s.verificationStatus === 'APPROVED').length;

  return (
    <ScrollView style={styles.allScroll} contentContainerStyle={styles.allContent}>
      <View style={styles.allGrid}>
        <AllTile label="Total Shops" value={String(totalShops)} iconBg={theme.color.primarySoft} icon="" />
        <AllTile label="Open Now" value={String(openShops)} iconBg={theme.color.successSoft} icon="" accent />
        <AllTile label="Approved" value={String(approvedShops)} iconBg={theme.color.accentSoft} icon="" />
      </View>

      <Text style={styles.allListTitle}>Your Shops</Text>
      {shops.map((s) => (
        <Pressable
          key={s.id}
          onPress={() => onPickShop(s.id)}
          style={({ pressed }) => [styles.allShopRow, pressed && { opacity: 0.7 }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.allShopName} numberOfLines={1}>{s.name}</Text>
            {s.city ? <Text style={styles.allShopCity}>{s.city}</Text> : null}
          </View>
          {togglingId === s.id ? (
            <ActivityIndicator size="small" color={theme.color.primary} />
          ) : (
            <Switch
              value={s.isOpen}
              onValueChange={(next) => handleToggle(s.id, next)}
              trackColor={{ false: theme.color.borderStrong, true: theme.color.primary }}
              thumbColor={theme.color.white}
            />
          )}
          <Text style={styles.allShopArrow}>›</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function AllTile({ label, value, icon, iconBg, accent = false }: { label: string; value: string; icon: string; iconBg: string; accent?: boolean }) {
  return (
    <View style={[styles.allTile, theme.shadow.sm]}>
      <View style={[styles.allTileIcon, { backgroundColor: iconBg }]}>
        <Text style={{ fontSize: 16 }}>{icon}</Text>
      </View>
      <Text style={[styles.allTileValue, accent && { color: theme.color.primary }]}>{value}</Text>
      <Text style={styles.allTileLabel}>{label}</Text>
    </View>
  );
}

function BottomTabs({ active, onChange, t }: { active: Tab; onChange: (t: Tab) => void; t: Strings }) {
  return (
    <View style={styles.tabbar}>
      {tabList(t).map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable key={tab.key} style={styles.tabItem} onPress={() => onChange(tab.key)}>
            <TabIcon name={tab.key} color={isActive ? theme.color.accent : theme.color.textFaint} />
            <Text style={[styles.tabLabel, isActive && styles.tabActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.accent },
  content: { flex: 1, width: '100%', maxWidth: theme.maxContentWidth, alignSelf: 'center', backgroundColor: theme.color.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space.md, backgroundColor: theme.color.bg },
  loadingText: { color: theme.color.textMuted, fontSize: theme.font.small },

  topbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    backgroundColor: theme.color.accent,
  },
  brand: { fontSize: theme.font.h3, fontWeight: '900', color: theme.color.white, letterSpacing: 0.3 },
  logoutBtn: { paddingHorizontal: theme.space.sm, paddingVertical: 4, borderRadius: theme.radius.sm },
  logout: { color: theme.color.white, fontWeight: '700', fontSize: theme.font.small, opacity: 0.9 },

  tabContent: { flex: 1 },

  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    backgroundColor: theme.color.accent,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
  },
  alertBody: { flex: 1, gap: 2 },
  alertTitle: { color: theme.color.white, fontWeight: '900', fontSize: theme.font.body },
  alertSub: { color: theme.color.white, opacity: 0.9, fontSize: theme.font.tiny },
  alertAck: {
    backgroundColor: theme.color.white,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  alertAckText: { color: theme.color.accent, fontWeight: '800', fontSize: theme.font.small },

  pickerWrap: {
    backgroundColor: theme.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.sm,
    gap: theme.space.xs,
  },
  pickerLabel: {
    fontSize: theme.font.tiny,
    fontWeight: '800',
    color: theme.color.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: theme.space.lg,
  },
  pickerRow: { paddingHorizontal: theme.space.lg, gap: theme.space.sm, paddingVertical: theme.space.xs },
  shopChip: {
    minWidth: 150,
    maxWidth: 220,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceAlt,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    gap: theme.space.xs,
  },
  shopChipActive: {
    borderColor: theme.color.accent,
    borderWidth: 2,
    backgroundColor: theme.color.accentSoft,
  },
  shopChipHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  shopChipName: { flex: 1, fontSize: theme.font.small, fontWeight: '800', color: theme.color.text },
  shopChipNameActive: { color: theme.color.accentDark },
  shopChipMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.xs },
  activeTag: { fontSize: theme.font.tiny, fontWeight: '800', color: theme.color.accent },

  tabbar: {    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    backgroundColor: theme.color.surface,
    paddingVertical: theme.space.sm,
    paddingBottom: theme.space.md,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 2 },
  tabLabel: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textFaint },
  tabActive: { color: theme.color.accent },

  // All-shops dashboard
  allScroll: { flex: 1, backgroundColor: theme.color.bg },
  allContent: { gap: theme.space.md, padding: theme.space.lg, paddingBottom: theme.space.xxl },
  allGrid: { flexDirection: 'row', gap: theme.space.md },
  allTile: {
    flex: 1,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    gap: 4,
    alignItems: 'flex-start',
  },
  allTileIcon: { width: 32, height: 32, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
  allTileValue: { fontSize: theme.font.h2, fontWeight: '900', color: theme.color.text },
  allTileLabel: { fontSize: theme.font.tiny, color: theme.color.textMuted, fontWeight: '600' },
  allListTitle: { fontSize: theme.font.body, fontWeight: '800', color: theme.color.text, marginTop: theme.space.xs },
  allShopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  allShopDot: { width: 10, height: 10, borderRadius: 5 },
  allShopName: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  allShopCity: { fontSize: theme.font.tiny, color: theme.color.textMuted, marginTop: 2 },
  allShopArrow: { fontSize: 20, color: theme.color.textFaint, fontWeight: '300' },
  allShopsHint: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  allShopsHintText: { fontSize: theme.font.body, color: theme.color.textMuted },
});
