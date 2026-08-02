import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LoginScreen } from './src/screens/LoginScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { ShopApprovalsScreen } from './src/screens/ShopApprovalsScreen';
import { ShopsScreen } from './src/screens/ShopsScreen';
import { RidersScreen } from './src/screens/RidersScreen';
import { SettlementsScreen } from './src/screens/SettlementsScreen';
import { PaymentClaimsScreen } from './src/screens/PaymentClaimsScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { DisputesScreen } from './src/screens/DisputesScreen';
import { CouponsScreen } from './src/screens/CouponsScreen';
import { CitiesScreen } from './src/screens/CitiesScreen';
import { TaskboardScreen } from './src/screens/TaskboardScreen';
import { GstScreen } from './src/screens/GstScreen';
import { hasSavedToken, logout, me, onAuthExpired } from './src/api';
import { theme } from './src/theme';
import { LanguageProvider, useLang } from './src/i18n/LanguageContext';
import { LanguagePicker } from './src/components/LanguagePicker';

/**
 * PassWaala Admin root. Flow: OTP login → an authenticated shell with a fixed
 * sidebar (Dashboard, Approvals, Settlements, + Admins for OWNER) + Logout. The
 * session token is persisted (src/api.ts) so a refresh/restart keeps the admin
 * signed in until Logout.
 *
 * Admin API routes require an ADMIN/OWNER token — a CUSTOMER token yields 403,
 * which each screen surfaces as a friendly "not an admin" message. On any 401
 * (expired token) the client fires onAuthExpired → we drop to login with a note.
 */
type Nav = 'dashboard' | 'approvals' | 'shops' | 'riders' | 'orders' | 'settlements' | 'disputes' | 'coupons' | 'cities' | 'taskboard' | 'gst';

export default function App() {
  return (
    <LanguageProvider>
      <AppRoot />
    </LanguageProvider>
  );
}

function AppRoot() {
  const [authed, setAuthed] = useState<boolean>(hasSavedToken());
  const [nav, setNav] = useState<Nav>('dashboard');
  const [role, setRole] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const isOwner = role === 'OWNER';

  // Read the signed-in role so we can show the OWNER-only "Admins" nav item.
  const loadRole = useCallback(async () => {
    try {
      const account = await me();
      setRole(account.role);
    } catch {
      // A 401 is handled by the auth-expired listener; other errors just leave
      // the role unknown (Admins stays hidden, screens still guard with 403).
      setRole(null);
    }
  }, []);

  useEffect(() => {
    if (authed) loadRole();
    else setRole(null);
  }, [authed, loadRole]);

  // Auto-logout on an expired/invalid session (any 401 from the API client).
  useEffect(() => {
    return onAuthExpired(() => {
      setAuthed(false);
      setRole(null);
      setNav('dashboard');
      setSessionExpired(true);
    });
  }, []);

  function doLogout() {
    logout();
    setAuthed(false);
    setRole(null);
    setNav('dashboard');
    setSessionExpired(false);
  }

  function onLoggedIn() {
    setSessionExpired(false);
    setAuthed(true);
  }

  if (!authed) {
    return (
      <View style={styles.root}>
        <StatusBar style="dark" />
        <LoginScreen onLoggedIn={onLoggedIn} sessionExpired={sessionExpired} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.shell}>
        <Sidebar nav={nav} onNavigate={setNav} onLogout={doLogout} isOwner={isOwner} />
        <View style={styles.main}>
          {nav === 'dashboard' && <DashboardScreen />}
          {nav === 'approvals' && <ShopApprovalsScreen />}
          {nav === 'shops' && <ShopsScreen />}
          {nav === 'riders' && <RidersScreen />}
          {nav === 'orders' && <OrdersScreen />}
          {nav === 'settlements' && <PaymentClaimsScreen />}
          {nav === 'disputes' && <DisputesScreen />}
          {nav === 'coupons' && <CouponsScreen />}
          {nav === 'cities' && isOwner && <CitiesScreen />}
          {nav === 'gst' && <GstScreen />}
          {nav === 'taskboard' && <TaskboardScreen />}
        </View>
      </View>
    </View>
  );
}

function Sidebar({
  nav,
  onNavigate,
  onLogout,
  isOwner,
}: {
  nav: Nav;
  onNavigate: (n: Nav) => void;
  onLogout: () => void;
  isOwner: boolean;
}) {
  const { t } = useLang();
  return (
    <View style={styles.sidebar}>
      <View style={styles.brandRow}>
        <View style={styles.logoMark}>
          <Text style={styles.logoText}>PW</Text>
        </View>
        <View>
          <Text style={styles.brand}>{t.app.brand}</Text>
          <Text style={styles.brandSub}>{t.app.brandSub}</Text>
        </View>
      </View>

      <View style={styles.navGroup}>
        <Text style={styles.navGroupLabel}>MAIN</Text>
        <NavItem
          label={t.nav.dashboard}
          active={nav === 'dashboard'}
          onPress={() => onNavigate('dashboard')}
        />

        <Text style={styles.navGroupLabel}>SHOP MANAGEMENT</Text>
        <NavItem
          label={t.nav.approvals}
          active={nav === 'approvals'}
          onPress={() => onNavigate('approvals')}
        />
        <NavItem
          label={t.nav.shops}
          active={nav === 'shops'}
          onPress={() => onNavigate('shops')}
        />
        <NavItem
          label={t.nav.riders}
          active={nav === 'riders'}
          onPress={() => onNavigate('riders')}
        />

        <Text style={styles.navGroupLabel}>ORDER MANAGEMENT</Text>
        <NavItem
          label="Orders"
          active={nav === 'orders'}
          onPress={() => onNavigate('orders')}
        />
        <NavItem
          label={t.nav.settlements}
          active={nav === 'settlements'}
          onPress={() => onNavigate('settlements')}
        />
        <NavItem
          label={t.nav.disputes}
          active={nav === 'disputes'}
          onPress={() => onNavigate('disputes')}
        />
        <NavItem
          label="Coupons"
          active={nav === 'coupons'}
          onPress={() => onNavigate('coupons')}
        />
        <NavItem
          label={t.nav.taskboard}
          active={nav === 'taskboard'}
          onPress={() => onNavigate('taskboard')}
        />
        <NavItem
          label="GST"
          active={nav === 'gst'}
          onPress={() => onNavigate('gst')}
        />
        {isOwner ? (
          <>
            <Text style={styles.navGroupLabel}>ADMIN</Text>
            <NavItem
              label={t.nav.cities}
              active={nav === 'cities'}
              onPress={() => onNavigate('cities')}
            />
          </>
        ) : null}
      </View>

      <View style={styles.spacer} />

      <View style={styles.sidebarFooter}>
        <LanguagePicker label={t.common.language} />
        <Pressable style={styles.logout} onPress={onLogout}>
          <Text style={styles.logoutText}>{t.app.logout}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function NavItem({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.navItem, active && styles.navItemActive]}
      onPress={onPress}
    >
      <Text style={[styles.navItemText, active && styles.navItemTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  shell: { flex: 1, flexDirection: 'row' },
  main: { flex: 1, backgroundColor: theme.color.bg },
  sidebar: {
    width: theme.sidebarWidth,
    backgroundColor: theme.color.sidebar,
    paddingVertical: theme.space.xl,
    paddingHorizontal: theme.space.md,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    paddingHorizontal: theme.space.sm,
    marginBottom: theme.space.xxl,
  },
  logoMark: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: '#fff', fontWeight: '800', fontSize: theme.font.body },
  brand: { color: '#fff', fontWeight: '800', fontSize: theme.font.h3 },
  brandSub: { color: theme.color.sidebarText, fontSize: theme.font.tiny },
  navGroup: { gap: 2 },
  navGroupLabel: {
    fontSize: theme.font.tiny,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 0.8,
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.lg,
    paddingBottom: theme.space.xs,
  },
  navItem: {
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.md,
  },
  navItemActive: { backgroundColor: theme.color.sidebarActive },
  navItemText: { color: theme.color.sidebarText, fontWeight: '600', fontSize: theme.font.body },
  navItemTextActive: { color: '#fff', fontWeight: '700' },
  spacer: { flex: 1 },
  sidebarFooter: { gap: theme.space.md },
  logout: {
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  logoutText: { color: theme.color.sidebarText, fontWeight: '600', fontSize: theme.font.body },
});
