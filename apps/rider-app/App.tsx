import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthExpiredError } from '@passwaala/api-client';
import { LoginScreen } from './src/screens/LoginScreen';
import { SignupScreen } from './src/screens/SignupScreen';
import { RegisterRiderScreen } from './src/screens/RegisterRiderScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { JobsScreen } from './src/screens/JobsScreen';
import { DeliveriesScreen } from './src/screens/DeliveriesScreen';
import { EarningsScreen } from './src/screens/EarningsScreen';
import { DuesScreen } from './src/screens/DuesScreen';
import { AlertsScreen } from './src/screens/AlertsScreen';
import { api, hasSavedToken, logout, onAuthExpired } from './src/api';
import { formatRupees, theme } from './src/theme';
import { useNewJobAlerts } from './src/useNewJobAlerts';
import { useSystemAlerts } from './src/useSystemAlerts';
import { unlockAudio } from './src/sound';
import { LanguageProvider, useLang } from './src/i18n/LanguageContext';
import type { RiderJob } from './src/types';

/** True for a 401 / expired-session error (either the typed error or status). */
function isAuthExpired(err: unknown): boolean {
  return err instanceof AuthExpiredError || (err as { status?: number })?.status === 401;
}

/**
 * PassWaala rider app root. Flow: login (OTP) → resolve rider (riderMe 200 = a
 * rider; 403/404 = must become a delivery partner) → main app with a hand-rolled
 * bottom tab bar (Home / Jobs / Deliveries) + Logout. The session token persists
 * (src/api.ts) so a refresh/restart keeps the rider logged in.
 */
type Stage = 'login' | 'resolving' | 'register' | 'app';
type Tab = 'home' | 'jobs' | 'deliveries' | 'earnings' | 'dues' | 'alerts';

/** Root export — provides device-local language state to the whole tree. */
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
  const [tab, setTab] = useState<Tab>('home');
  const [online, setOnline] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  // One-time audio unlock: browser autoplay policy needs a user gesture before
  // the new-job beep can sound. We flip this on the first touch after login.
  const audioUnlockedRef = useRef(false);

  // App-wide new-job alerts — polls + rings on EVERY tab (not just Jobs) while
  // we're signed in AND online (jobs are only offered to online riders).
  // Poll for new-job alerts app-wide, EXCEPT when the Jobs screen is open —
  // that screen already polls /jobs, so we'd be double-polling otherwise.
  const alerts = useNewJobAlerts(stage === 'app' && online && tab !== 'jobs');

  // App-wide SYSTEM alerts (escalations / penalties) — polls + vibrates + fires
  // an OS notification on ANY tab while signed in (online OR offline — an
  // escalation about a stuck delivery still matters when the rider went idle).
  const systemAlerts = useSystemAlerts(stage === 'app');

  const TABS: { key: Tab; label: string; icon: string; badge?: number }[] = [
    { key: 'home', label: t.tabs.home, icon: '⌂' },
    { key: 'jobs', label: t.tabs.jobs, icon: '☰' },
    { key: 'deliveries', label: t.tabs.deliveries, icon: '✓' },
    { key: 'earnings', label: t.tabs.earnings, icon: '₹' },
    { key: 'dues', label: t.tabs.dues, icon: '⛁' },
    { key: 'alerts', label: t.tabs.alerts, icon: '🔔', badge: systemAlerts.unread },
  ];

  /** Unlock audio on the first user interaction (idempotent). */
  const unlockAudioOnce = useCallback(() => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;
    unlockAudio();
  }, []);

  // Once in the app, proactively ask for browser notification permission so the
  // OS popup can fire when the tab is backgrounded. No-op if already decided.
  useEffect(() => {
    if (stage === 'app' && !alerts.notifyGranted) {
      void alerts.requestPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  /** After login (or on startup with a saved token), check for a rider profile. */
  const resolveRider = useCallback(async () => {
    setSessionExpired(false);
    setStage('resolving');
    try {
      const rider = await api.riderMe(); // 200 → is a rider
      setOnline(rider.online);
      setTab('home');
      setStage('app');
    } catch (err) {
      // A 401 / expired session must NOT be treated as "not a rider yet" — the
      // onUnauthorized listener already routes us to login. Only a 403/404
      // (not a rider) means "go register".
      if (isAuthExpired(err)) return;
      setStage('register');
    }
  }, []);

  // On startup with a restored token, resolve straight into the app.
  useEffect(() => {
    if (hasSavedToken()) {
      resolveRider();
    }
  }, [resolveRider]);

  // Any 401 anywhere clears the token in the client; route back to login and
  // show a "session expired" note.
  useEffect(() => {
    return onAuthExpired(() => {
      setOnline(false);
      setSessionExpired(true);
      setAuthScreen('login');
      setStage('login');
    });
  }, []);

  function doLogout() {
    logout();
    setOnline(false);
    setSessionExpired(false);
    setAuthScreen('login');
    setStage('login');
  }

  return (
    <SafeAreaView style={styles.root} onStartShouldSetResponder={() => { unlockAudioOnce(); return false; }}>
      <StatusBar style="light" />
      <View style={styles.content}>
        {stage === 'login' && (
          authScreen === 'signup' ? (
            <SignupScreen
              onSignedUp={() => {
                setAuthScreen('login');
                resolveRider();
              }}
              onBackToLogin={() => setAuthScreen('login')}
            />
          ) : (
            <LoginScreen
              onLoggedIn={resolveRider}
              sessionExpired={sessionExpired}
              onSignUp={() => setAuthScreen('signup')}
            />
          )
        )}

        {stage === 'resolving' && (
          <View style={styles.center}>
            <ActivityIndicator color={theme.color.accent} size="large" />
            <Text style={styles.loadingText}>{t.app.loadingProfile}</Text>
          </View>
        )}

        {stage === 'register' && (
          <>
            <TopBar title={t.app.becomePartner} onLogout={doLogout} />
            <RegisterRiderScreen
              onRegistered={() => {
                setTab('home');
                setStage('app');
              }}
            />
          </>
        )}

        {stage === 'app' && (
          <>
            <TopBar title={t.app.brand} onLogout={doLogout} />
            {alerts.alertJob ? (
              <NewJobBanner
                job={alerts.alertJob}
                silent={alerts.alertSilent}
                onView={() => {
                  unlockAudioOnce();
                  setTab('jobs');
                  alerts.acknowledge();
                }}
                onAcknowledge={() => {
                  unlockAudioOnce();
                  alerts.acknowledge();
                }}
              />
            ) : null}
            <View style={styles.tabContent}>
              {tab === 'home' && <HomeScreen online={online} onOnlineChange={setOnline} />}
              {tab === 'jobs' && <JobsScreen online={online} />}
              {tab === 'deliveries' && <DeliveriesScreen />}
              {tab === 'earnings' && <EarningsScreen />}
              {tab === 'dues' && <DuesScreen />}
              {tab === 'alerts' && <AlertsScreen alerts={systemAlerts.alerts} onSeen={systemAlerts.markSeen} />}
            </View>
            <BottomTabs tabs={TABS} active={tab} onChange={setTab} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function TopBar({ title, onLogout }: { title: string; onLogout: () => void }) {
  const { t } = useLang();
  return (
    <View style={styles.topbar}>
      <Text style={styles.brand}>{title}</Text>
      <Pressable onPress={onLogout} hitSlop={8} style={styles.logoutBtn}>
        <Text style={styles.logout}>{t.app.logout}</Text>
      </Pressable>
    </View>
  );
}

/**
 * NewJobBanner — the app-wide loud alert shown above the tab content whenever a
 * fresh delivery job lands, on ANY tab. Tapping the body jumps to Jobs; the
 * sound (from sound.ts) loops and the device vibrates until acknowledged.
 */
function NewJobBanner({
  job,
  silent,
  onView,
  onAcknowledge,
}: {
  job: RiderJob;
  silent: boolean;
  onView: () => void;
  onAcknowledge: () => void;
}) {
  const { t } = useLang();
  return (
    <Pressable onPress={onView} style={styles.alertBanner}>
      <View style={styles.alertBody}>
        <Text style={styles.alertTitle}>
          {t.app.newJobTitle(job.shop?.name ?? t.app.pickup, formatRupees(job.deliveryFeePaise))}
        </Text>
        <Text style={styles.alertSub}>
          {silent ? t.app.enableSound : t.app.tapToView}
        </Text>
      </View>
      <Pressable onPress={onAcknowledge} style={styles.alertAck} hitSlop={8}>
        <Text style={styles.alertAckText}>{t.app.acknowledge}</Text>
      </Pressable>
    </Pressable>
  );
}

function BottomTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: Tab; label: string; icon: string; badge?: number }[];
  active: Tab;
  onChange: (t: Tab) => void;
}) {
  return (
    <View style={styles.tabbar}>
      {tabs.map((item) => {
        const isActive = item.key === active;
        return (
          <Pressable key={item.key} style={styles.tabItem} onPress={() => onChange(item.key)}>
            <View>
              <Text style={[styles.tabIcon, isActive && styles.tabActive]}>{item.icon}</Text>
              {item.badge && item.badge > 0 ? (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{item.badge > 9 ? '9+' : item.badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.tabLabel, isActive && styles.tabActive]}>{item.label}</Text>
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

  tabbar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    backgroundColor: theme.color.surface,
    paddingVertical: theme.space.sm,
    paddingBottom: theme.space.md,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 2 },
  tabIcon: { fontSize: 18, color: theme.color.textFaint },
  tabLabel: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textFaint },
  tabActive: { color: theme.color.accent },
  tabBadge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: theme.color.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
