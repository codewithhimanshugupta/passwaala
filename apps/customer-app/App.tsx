import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { PlaceOrderResult } from '@passwaala/shared';
import { LoginScreen } from './src/screens/LoginScreen';
import { SignupScreen } from './src/screens/SignupScreen';
import { NameOnboardingScreen } from './src/screens/NameOnboardingScreen';
import { LocationPermissionScreen } from './src/screens/LocationPermissionScreen';
import { DiscoveryScreen } from './src/screens/DiscoveryScreen';
import { StorefrontScreen } from './src/screens/StorefrontScreen';
import { CartScreen } from './src/screens/CartScreen';
import { OrderTrackingScreen } from './src/screens/OrderTrackingScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { api, hasSavedToken, logout, onAuthExpired } from './src/api';
import { connectSocket, disconnectSocket } from './src/socket';
import type { Account } from './src/types';
import { resetCartStore, useCart } from './src/cart';
import { clearCheckoutPrefetch } from './src/checkoutPrefetch';
import { TabIcon } from './src/TabIcon';
import { shadow, theme } from './src/theme';
import { LanguageProvider, useLang } from './src/i18n/LanguageContext';

function OrderConfirmedScreen({
  orderId,
  result,
  onTrack,
  onHome,
}: {
  orderId: string;
  result: PlaceOrderResult;
  onTrack: () => void;
  onHome: () => void;
}) {
  const shortId = orderId.slice(0, 8).toUpperCase();
  return (
    <View style={confirmedStyles.root}>
      <View style={confirmedStyles.body}>
        {/* Checkmark circle */}
        <View style={confirmedStyles.checkCircle}>
          <View style={confirmedStyles.checkMark} />
        </View>

        <Text style={confirmedStyles.title}>Congratulations!</Text>
        <Text style={confirmedStyles.subtitle}>Your order has been placed successfully</Text>

        {/* Order ID pill */}
        <Pressable style={confirmedStyles.orderIdPill} onPress={onTrack}>
          <Text style={confirmedStyles.orderIdLabel}>ORDER ID</Text>
          <Text style={confirmedStyles.orderIdValue}>#{shortId}</Text>
          <Text style={confirmedStyles.orderIdHint}>Tap to track →</Text>
        </Pressable>

        <Text style={confirmedStyles.note}>
          Your order is being sent to the shop. You'll be notified as it progresses.
        </Text>
      </View>

      <View style={confirmedStyles.actions}>
        <Pressable style={confirmedStyles.trackBtn} onPress={onTrack}>
          <Text style={confirmedStyles.trackBtnText}>Track Order</Text>
        </Pressable>
        <Pressable style={confirmedStyles.homeBtn} onPress={onHome}>
          <Text style={confirmedStyles.homeBtnText}>Go to Home</Text>
        </Pressable>
      </View>
    </View>
  );
}

const confirmedStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 20 },
  checkCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: theme.color.primary,
    alignItems: 'center', justifyContent: 'center',
    ...shadow.md,
  },
  checkMark: {
    width: 40, height: 22,
    borderLeftWidth: 6, borderBottomWidth: 6, borderColor: '#fff',
    transform: [{ rotate: '-45deg' }],
    marginTop: -8,
  },
  title: { fontSize: 28, fontWeight: '900', color: theme.color.primary, textAlign: 'center' },
  subtitle: { fontSize: 16, color: theme.color.textMuted, textAlign: 'center' },
  orderIdPill: {
    backgroundColor: theme.color.primaryLight,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 28,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderColor: theme.color.primary,
    width: '100%',
  },
  orderIdLabel: { fontSize: 11, fontWeight: '800', color: theme.color.primary, letterSpacing: 1.5, textTransform: 'uppercase' },
  orderIdValue: { fontSize: 24, fontWeight: '900', color: theme.color.primaryDark, letterSpacing: 2 },
  orderIdHint: { fontSize: 12, color: theme.color.primary, opacity: 0.7 },
  note: { fontSize: 13, color: theme.color.textFaint, textAlign: 'center', lineHeight: 19 },
  actions: { paddingHorizontal: 24, paddingBottom: 32, gap: 12 },
  trackBtn: {
    backgroundColor: theme.color.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    ...shadow.sm,
  },
  trackBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  homeBtn: {
    backgroundColor: theme.color.bg,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: theme.color.border,
  },
  homeBtnText: { color: theme.color.textMuted, fontWeight: '700', fontSize: 15 },
});

/**
 * PassWaala customer app root. A hand-rolled in-memory navigator: a bottom tab
 * bar (Home / Cart / Orders / Profile) plus pushed detail views (storefront,
 * order tracking). No react-navigation dep. The session token is persisted (see
 * src/api.ts) so a refresh/restart keeps the user logged in.
 */
type Tab = 'home' | 'cart' | 'orders' | 'profile';

type Stack =
  | { name: 'tabs' }
  | { name: 'shop'; shopId: string }
  | { name: 'confirmed'; orderId: string; result: PlaceOrderResult }
  | { name: 'track'; orderId: string; result?: PlaceOrderResult };

export default function App() {
  return (
    <LanguageProvider>
      <AppRoot />
    </LanguageProvider>
  );
}

function AppRoot() {
  const { t } = useLang();
  const [loggedIn, setLoggedIn] = useState(hasSavedToken());
  const [authScreen, setAuthScreen] = useState<'login' | 'signup'>('login');
  const [tab, setTab] = useState<Tab>('home');
  const [stack, setStack] = useState<Stack>({ name: 'tabs' });
  const [sessionExpired, setSessionExpired] = useState(false);
  // Persist discovery view mode + selected map shop so back-from-shop returns correctly.
  const [discoveryViewMode, setDiscoveryViewMode] = useState<'list' | 'map'>('list');
  const [discoverySelectedShopId, setDiscoverySelectedShopId] = useState<string | null>(null);

  // Delivery location lifted to the root so it PERSISTS across navigating into a
  // shop and back (DiscoveryScreen unmounts on that nav). GPS runs at most once
  // and never overrides a location the user has explicitly picked.
  //   coords     — the active lat/lng used for nearby search
  //   placeName  — human label for the location bar
  //   addressPicked — true once the user chose a saved address (locks out GPS override)
  //   gpsTried   — so we auto-run GPS only once per session
  const [loc, setLoc] = useState<{
    coords: { lat: number; lng: number } | null;
    placeName: string | null;
    addressPicked: boolean;
    gpsTried: boolean;
  }>({ coords: null, placeName: null, addressPicked: false, gpsTried: false });
  // Name used in the location permission greeting after onboarding.
  const [onboardedName, setOnboardedName] = useState<string | null>(null);
  const [showLocationPerm, setShowLocationPerm] = useState(false);

  // Name onboarding gate: after login we fetch me() to decide whether to show
  // the one-time "What's your name?" screen (no name yet) before the tabs.
  // 'checking' → fetching me(); 'needed' → show onboarding; 'ok' → into tabs.
  const [nameStatus, setNameStatus] = useState<'checking' | 'needed' | 'ok'>('checking');

  const checkName = useCallback(async () => {
    setNameStatus('checking');
    try {
      const me = (await api.me()) as Account;
      setNameStatus(me.name && me.name.trim() ? 'ok' : 'needed');
    } catch {
      // If we can't verify (transient), don't block the app — proceed to tabs.
      setNameStatus('ok');
    }
  }, []);

  useEffect(() => {
    if (loggedIn) void checkName();
  }, [loggedIn, checkName]);

  // Connect the realtime socket while logged in (live order tracking); disconnect on logout.
  useEffect(() => {
    if (loggedIn) {
      connectSocket();
      return () => disconnectSocket();
    }
  }, [loggedIn]);

  // When any request 401s, the client clears the token and fires onAuthExpired.
  // Drop back to login with a brief notice instead of surfacing a raw error.
  useEffect(() => {
    return onAuthExpired(() => {
      resetCartStore();
      clearCheckoutPrefetch();
      setSessionExpired(true);
      setLoggedIn(false);
      setNameStatus('checking');
      setTab('home');
      setStack({ name: 'tabs' });
    });
  }, []);

  function doLogout() {
    logout();
    resetCartStore();
    clearCheckoutPrefetch();
    setSessionExpired(false);
    setLoggedIn(false);
    setNameStatus('checking');
    setTab('home');
    setStack({ name: 'tabs' });
  }

  function goTab(next: Tab) {
    setStack({ name: 'tabs' });
    setTab(next);
  }

  if (!loggedIn) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" />
        <View style={styles.content}>
          {authScreen === 'signup' ? (
            <SignupScreen
              onSignedUp={() => {
                setSessionExpired(false);
                setAuthScreen('login');
                setLoggedIn(true);
              }}
              onBackToLogin={() => setAuthScreen('login')}
            />
          ) : (
            <LoginScreen
              notice={sessionExpired ? t.login.sessionExpired : undefined}
              onSignUp={() => setAuthScreen('signup')}
              onLoggedIn={() => {
                setSessionExpired(false);
                setLoggedIn(true);
              }}
            />
          )}
        </View>
      </SafeAreaView>
    );
  }

  // Logged in but still verifying whether a name exists — brief splash.
  if (nameStatus === 'checking') {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" />
        <View style={[styles.content, styles.splash]}>
          <ActivityIndicator color={theme.color.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // One-time name onboarding before the tabs (new users with no name).
  if (nameStatus === 'needed') {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" />
        <View style={styles.content}>
          <NameOnboardingScreen onDone={(name) => {
              setOnboardedName(name);
              setShowLocationPerm(true);
              setNameStatus('ok');
            }} />
        </View>
      </SafeAreaView>
    );
  }

  // Location permission — shown once after name onboarding (new users only).
  if (showLocationPerm) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        <View style={styles.content}>
          <LocationPermissionScreen
            name={onboardedName ?? undefined}
            onGranted={() => setShowLocationPerm(false)}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Pushed (full-screen) detail views sit above the tab bar.
  if (stack.name === 'shop') {
    return (
      <Shell showTabs={false} tab={tab} onTab={goTab}>
        <StorefrontScreen
          shopId={stack.shopId}
          onBack={() => {
            // If this shop was opened from the map, keep the map view; clear popup.
            // If from list, stay in list.
            if (discoveryViewMode === 'map') setDiscoverySelectedShopId(null);
            setStack({ name: 'tabs' });
          }}
          onOpenCart={() => goTab('cart')}
        />
      </Shell>
    );
  }

  if (stack.name === 'confirmed') {
    return (
      <Shell showTabs={false} tab={tab} onTab={goTab}>
        <OrderConfirmedScreen
          orderId={stack.orderId}
          result={stack.result}
          onTrack={() => setStack({ name: 'track', orderId: stack.orderId, result: stack.result })}
          onHome={() => { goTab('home'); setStack({ name: 'tabs' }); }}
        />
      </Shell>
    );
  }

  if (stack.name === 'track') {
    return (
      <Shell showTabs={false} tab={tab} onTab={goTab}>
        <OrderTrackingScreen
          orderId={stack.orderId}
          placeResult={stack.result}
          onDone={() => goTab('orders')}
        />
      </Shell>
    );
  }

  return (
    <Shell showTabs tab={tab} onTab={goTab}>
      {tab === 'home' && (
        <DiscoveryScreen
            onOpenShop={(shopId) => {
              setDiscoverySelectedShopId(shopId);
              setStack({ name: 'shop', shopId });
            }}
            viewMode={discoveryViewMode}
            onViewModeChange={setDiscoveryViewMode}
            restoredShopId={discoverySelectedShopId}
            loc={loc}
            onLocChange={setLoc}
          />
      )}
      {tab === 'cart' && (
        <CartScreen
          onBack={() => goTab('home')}
          onBrowse={() => goTab('home')}
          onPlaced={(result) => setStack({ name: 'confirmed', orderId: result.orderId, result })}
        />
      )}
      {tab === 'orders' && (
        <OrdersScreen
          onOpenOrder={(orderId) => setStack({ name: 'track', orderId })}
          onReordered={() => goTab('cart')}
          onBrowse={() => goTab('home')}
        />
      )}
      {tab === 'profile' && <ProfileScreen onLogout={doLogout} />}
    </Shell>
  );
}

function Shell({
  children,
  showTabs,
  tab,
  onTab,
}: {
  children: React.ReactNode;
  showTabs: boolean;
  tab: Tab;
  onTab: (t: Tab) => void;
}) {
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <View style={styles.body}>{children}</View>
        {showTabs ? <TabBar tab={tab} onTab={onTab} /> : null}
      </View>
    </SafeAreaView>
  );
}

const TABS: { key: Tab }[] = [
  { key: 'home' },
  { key: 'cart' },
  { key: 'orders' },
  { key: 'profile' },
];

function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const { itemCount } = useCart();
  const { t } = useLang();
  return (
    <View style={styles.tabBar}>
      {TABS.map((item) => {
        const active = item.key === tab;
        return (
          <Pressable key={item.key} style={styles.tabItem} onPress={() => onTab(item.key)}>
            <View style={[styles.tabIndicator, active && styles.tabIndicatorActive]} />
            <View style={styles.tabIconWrap}>
              <TabIcon
                name={item.key}
                color={active ? theme.color.primary : theme.color.textMuted}
              />
              {item.key === 'cart' && itemCount > 0 ? (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{itemCount > 9 ? '9+' : itemCount}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.tabs[item.key]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  content: { flex: 1, width: '100%', maxWidth: theme.maxContentWidth, alignSelf: 'center', backgroundColor: theme.color.surface },
  body: { flex: 1 },
  splash: { alignItems: 'center', justifyContent: 'center' },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: theme.color.bg,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingBottom: Platform.OS === 'ios' ? theme.space.lg : theme.space.sm,
    ...shadow.lg,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 2, paddingBottom: theme.space.xs },
  tabIndicator: { height: 3, width: '60%', borderRadius: 2, backgroundColor: 'transparent', marginBottom: 6 },
  tabIndicatorActive: { backgroundColor: theme.color.primary },
  tabIconWrap: { position: 'relative' },
  tabIcon: { fontSize: 22, opacity: 0.4 },
  tabIconActive: { opacity: 1 },
  tabLabel: { fontSize: theme.font.tiny, color: theme.color.textMuted, fontWeight: theme.weight.medium },
  tabLabelActive: { color: theme.color.primary, fontWeight: theme.weight.bold },

  tabBadge: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: theme.color.danger,
    borderRadius: theme.radius.pill,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: { color: '#fff', fontSize: theme.font.tiny, fontWeight: theme.weight.bold },
});
