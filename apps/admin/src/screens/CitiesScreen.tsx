import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '@nearbaz/api-client';
import { api } from '../api';
import { theme } from '../theme';
import { useLang } from '../i18n/LanguageContext';

interface City {
  id: string;
  name: string;
  enabled: boolean;
  collectionUpiVpa: string | null;
  collectionUpiName: string | null;
  deliveryRadiusMeters: number;
  riderCheckRadiusMeters: number;
  deliveryTiersJson: string | null;
  requireRiderForDelivery: boolean;
  multiShopSurchargePaise: number;
  bulkShopRadiusMeters: number;
  codMinOrderPaise: number;
  codMaxPerDay: number;
  codCancelBlockAfter: number;
  codCancelWindowDays: number;
  codWindowHours: number;
  // Operational config
  autoCancelMinutes: number;
  riderOfferWindowSec: number;
  maxActiveOrdersPerRider: number;
  shopReminderMinutes: number;
  staleRiderMinutes: number;
  nearbyShopsRadiusMeters: number;
  // Fee / commission config
  platformFeePaise: number;
  defaultCommissionRate: number;
  defaultCreditLimitPaise: number;
  commissionHolidayDays: number;
  onboardingFeePaise: number;
  // Referral / coin config
  referralCustomerCoins: number;
  referralShopCoins: number;
  admin: { phone: string | null } | null;
}

interface AdminInvite {
  inviteId: string;
  phone: string | null;
  email: string | null;
  role: string;
  status: string;
  createdAt: string;
  city: { id: string; name: string } | null;
}

const STATUS_PENDING = 'PENDING_OWNER_APPROVAL';
const STATUS_ACTIVE = 'ACTIVE';

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

type Tab = 'cities' | 'admins';

export function CitiesScreen() {
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>('cities');
  const [cities, setCities] = useState<City[]>([]);
  const [admins, setAdmins] = useState<AdminInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [showAddWizard, setShowAddWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [newCityName, setNewCityName] = useState('');
  const [newCityUpiVpa, setNewCityUpiVpa] = useState('');
  const [newCityUpiName, setNewCityUpiName] = useState('');
  const [createdCityId, setCreatedCityId] = useState<string | null>(null);
  const [wizardAdminPhone, setWizardAdminPhone] = useState('');
  const [wizardAdminEmail, setWizardAdminEmail] = useState('');
  const [wizardBusy, setWizardBusy] = useState(false);

  // Admin tab state
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteCityId, setInviteCityId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [adminBusyId, setAdminBusyId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  // City edit
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setForbidden(false);
    try {
      const [cityData, adminData] = await Promise.all([api.ownerListCities(), api.ownerListAdmins()]);
      setCities(cityData as City[]);
      setAdmins(adminData as AdminInvite[]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else setError((e as Error).message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  function flash(msg: string) {
    setBanner(msg);
    setTimeout(() => setBanner(null), 3500);
  }

  // ── Wizard: step 1 — create city ──
  async function wizardCreateCity() {
    if (!newCityName.trim()) { flash('City name is required.'); return; }
    setWizardBusy(true);
    try {
      const result = await api.ownerUpsertCity(newCityName.trim(), {
        collectionUpiVpa: newCityUpiVpa.trim() || undefined,
        collectionUpiName: newCityUpiName.trim() || undefined,
      }) as { id?: string } | undefined;
      // Reload to get the new city id
      await load();
      const fresh = (await api.ownerListCities()) as City[];
      const created = fresh.find(c => c.name.toLowerCase() === newCityName.trim().toLowerCase());
      setCreatedCityId((result as { id?: string })?.id ?? created?.id ?? null);
      setWizardStep(2);
    } catch (e) { flash(`Failed: ${(e as Error).message}`); }
    finally { setWizardBusy(false); }
  }

  // ── Wizard: step 2 — invite admin for new city (optional) ──
  async function wizardInviteAdmin() {
    setWizardBusy(true);
    try {
      if (wizardAdminPhone.trim()) {
        const inv = await api.ownerInviteAdmin({ phone: wizardAdminPhone.trim(), email: wizardAdminEmail.trim() || undefined }) as { inviteId: string };
        if (createdCityId && inv.inviteId) await api.ownerAssignAdminCity(inv.inviteId, createdCityId);
      }
      flash(`City "${newCityName}" created${wizardAdminPhone.trim() ? ` and ${wizardAdminPhone.trim()} invited as admin` : ''}.`);
      setShowAddWizard(false);
      resetWizard();
      await load();
    } catch (e) { flash(`Failed: ${(e as Error).message}`); }
    finally { setWizardBusy(false); }
  }

  function resetWizard() {
    setWizardStep(1); setNewCityName(''); setNewCityUpiVpa(''); setNewCityUpiName('');
    setCreatedCityId(null); setWizardAdminPhone(''); setWizardAdminEmail('');
  }

  async function toggleCity(city: City) {
    setBusyId(city.id);
    // Optimistic: flip the enabled flag immediately (the Enabled/Live badges are
    // derived from it); restore the prior list and show the error on failure.
    const prev = cities;
    setCities((list) => list.map((c) => (c.id === city.id ? { ...c, enabled: !c.enabled } : c)));
    try {
      await api.ownerSetCityEnabled(city.id, !city.enabled);
      flash(city.enabled ? `${city.name} disabled.` : `${city.name} enabled.`);
    } catch (e) { setCities(prev); flash(`Failed: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  }

  async function inviteAdmin() {
    if (!invitePhone.trim()) { flash('Phone is required.'); return; }
    setInviting(true);
    try {
      const inv = await api.ownerInviteAdmin({ phone: invitePhone.trim(), email: inviteEmail.trim() || undefined }) as { inviteId: string };
      if (inviteCityId && inv.inviteId) await api.ownerAssignAdminCity(inv.inviteId, inviteCityId);
      flash(`Invited ${invitePhone.trim()}.`);
      setInvitePhone(''); setInviteEmail(''); setInviteCityId(null);
      await load();
    } catch (e) { flash(`Failed: ${(e as Error).message}`); }
    finally { setInviting(false); }
  }

  async function approveAdmin(admin: AdminInvite) {
    setAdminBusyId(admin.inviteId);
    try {
      await api.ownerApproveAdmin(admin.inviteId);
      flash(`Approved ${admin.phone ?? 'admin'}.`);
      await load();
    } catch (e) { flash(`Failed: ${(e as Error).message}`); }
    finally { setAdminBusyId(null); }
  }

  async function revokeAdmin(admin: AdminInvite) {
    setAdminBusyId(admin.inviteId);
    try {
      await api.ownerRevokeAdmin(admin.inviteId);
      flash(`Revoked ${admin.phone ?? 'admin'}.`);
      await load();
    } catch (e) { flash(`Failed: ${(e as Error).message}`); }
    finally { setAdminBusyId(null); }
  }

  async function assignAdminCity(admin: AdminInvite, cityId: string | null) {
    setAssigningId(admin.inviteId);
    try {
      await api.ownerAssignAdminCity(admin.inviteId, cityId);
      flash(cityId ? `City assigned to ${admin.phone}.` : `City cleared for ${admin.phone}.`);
      await load();
    } catch (e) { flash(`Failed: ${(e as Error).message}`); }
    finally { setAssigningId(null); }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={theme.color.accent} size="large" /></View>;
  }

  if (forbidden) {
    return (
      <View style={styles.center}>
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Owner only</Text>
          <Text style={styles.noticeBody}>This section is only accessible to the NearBaz owner account.</Text>
        </View>
      </View>
    );
  }

  const activeCities = cities.filter(c => c.enabled).length;
  const activeAdmins = admins.filter(a => a.status === STATUS_ACTIVE).length;

  return (
    <View style={styles.wrap}>
      {banner ? <View style={styles.banner}><Text style={styles.bannerText}>{banner}</Text></View> : null}

      {/* Page header */}
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.h1}>Cities & Admins</Text>
          <Text style={styles.sub}>{cities.length} cit{cities.length === 1 ? 'y' : 'ies'} · {activeCities} active · {admins.length} admin{admins.length === 1 ? '' : 's'} ({activeAdmins} active)</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.refresh} onPress={load}><Text style={styles.refreshText}>Refresh</Text></Pressable>
          <Pressable style={styles.addBtn} onPress={() => { resetWizard(); setShowAddWizard(true); }}>
            <Text style={styles.addBtnText}>+ Add City</Text>
          </Pressable>
        </View>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['cities', 'admins'] as Tab[]).map(t => (
          <Pressable key={t} style={[styles.tabItem, tab === t && styles.tabItemActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'cities' ? `Cities (${cities.length})` : `Admins (${admins.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── Tab: Cities ── */}
      {tab === 'cities' && (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {cities.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No cities yet</Text>
              <Text style={styles.emptyBody}>Click "+ Add City" to create your first city and assign an admin to it.</Text>
            </View>
          ) : (
            cities.map(city => {
              const assignedAdmins = admins.filter(a => a.city?.id === city.id && a.status === STATUS_ACTIVE);
              const busy = busyId === city.id;
              return (
                <CityRow
                  key={city.id}
                  city={city}
                  admins={assignedAdmins}
                  busy={busy}
                  onToggle={() => toggleCity(city)}
                  onAddAdmin={() => { setInviteCityId(city.id); setTab('admins'); }}
                  onUpdate={async (data) => {
                    try {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      await api.ownerUpsertCity(city.name, data as any);
                      await load();
                    } catch (e) { flash(`Update failed: ${(e as Error).message}`); }
                  }}
                />
              );
            })
          )}
        </ScrollView>
      )}

      {/* ── Tab: Admins ── */}
      {tab === 'admins' && (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* Invite form */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Invite an Admin</Text>
            <Text style={styles.cardHint}>They sign in with this phone, then you approve them here. A city must be assigned so they manage that city's shops.</Text>
            <View style={styles.formRow}>
              <View style={styles.field}>
                <Text style={styles.label}>Phone number</Text>
                <TextInput style={styles.input} placeholder="+91 98765..." placeholderTextColor={theme.color.textFaint} keyboardType="phone-pad" value={invitePhone} onChangeText={setInvitePhone} />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Email (optional)</Text>
                <TextInput style={styles.input} placeholder="name@nearbaz.in" placeholderTextColor={theme.color.textFaint} autoCapitalize="none" value={inviteEmail} onChangeText={setInviteEmail} />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Assign city</Text>
                <CityDropdown
                  cities={cities}
                  value={inviteCityId}
                  onChange={setInviteCityId}
                />
              </View>
            </View>
            <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]} onPress={inviteAdmin} disabled={inviting}>
              {inviting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send invite</Text>}
            </Pressable>
          </View>

          {admins.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No admins yet</Text>
              <Text style={styles.emptyBody}>Invite an admin above. They sign in and you approve them.</Text>
            </View>
          ) : admins.map(admin => {
            const isActive = admin.status === STATUS_ACTIVE;
            const isPending = admin.status === STATUS_PENDING;
            const busy = adminBusyId === admin.inviteId;
            const assigning = assigningId === admin.inviteId;
            return (
              <View key={admin.inviteId} style={styles.card}>
                <View style={styles.adminCardHead}>
                  <View style={styles.adminAvatar}>
                    <Text style={styles.adminAvatarText}>{(admin.phone ?? '?').slice(-2)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.titleRow}>
                      <Text style={styles.name}>{admin.phone ?? '—'}</Text>
                      <StatusBadge status={admin.status} />
                    </View>
                    <Text style={styles.meta}>{admin.email ?? 'no email'} · {admin.role} · {fmtDate(admin.createdAt)}</Text>
                    <Text style={styles.meta}>
                      {admin.city ? `City: ${admin.city.name}` : 'No city assigned'}
                    </Text>
                  </View>
                  <View style={styles.adminActions}>
                    {isPending && (
                      <Pressable style={[styles.actionBtn, { backgroundColor: theme.color.good }]} onPress={() => approveAdmin(admin)} disabled={busy}>
                        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.actionBtnText}>Approve</Text>}
                      </Pressable>
                    )}
                    {isActive && (
                      <Pressable style={[styles.actionBtn, { backgroundColor: theme.color.critical }]} onPress={() => revokeAdmin(admin)} disabled={busy}>
                        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.actionBtnText}>Revoke</Text>}
                      </Pressable>
                    )}
                  </View>
                </View>
                {/* City reassignment for active admins */}
                {isActive && (
                  <View style={styles.cityPicker}>
                    <Text style={styles.label}>City assignment {assigning ? '(saving…)' : ''}</Text>
                    <CityDropdown
                      cities={cities}
                      value={admin.city?.id ?? null}
                      onChange={(cityId) => !assigning && assignAdminCity(admin, cityId)}
                      disabled={assigning}
                      showNone
                    />
                    {assigning && <ActivityIndicator color={theme.color.accent} style={{ marginTop: theme.space.xs }} />}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* ── Add City Wizard Modal ── */}
      <Modal visible={showAddWizard} transparent animationType="fade" onRequestClose={() => { setShowAddWizard(false); resetWizard(); }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {/* Step indicator */}
            <View style={styles.wizardSteps}>
              <View style={[styles.wizardStep, wizardStep >= 1 && styles.wizardStepActive]}>
                <Text style={[styles.wizardStepNum, wizardStep >= 1 && styles.wizardStepNumActive]}>1</Text>
                <Text style={styles.wizardStepLabel}>Create City</Text>
              </View>
              <View style={styles.wizardStepLine} />
              <View style={[styles.wizardStep, wizardStep >= 2 && styles.wizardStepActive]}>
                <Text style={[styles.wizardStepNum, wizardStep >= 2 && styles.wizardStepNumActive]}>2</Text>
                <Text style={styles.wizardStepLabel}>Assign Admin</Text>
              </View>
            </View>

            {wizardStep === 1 ? (
              <>
                <Text style={styles.modalTitle}>New City</Text>
                <Text style={styles.modalHint}>Enter the city details. You'll assign an admin in the next step.</Text>
                <View style={styles.formCol}>
                  <View style={styles.field}>
                    <Text style={styles.label}>City name *</Text>
                    <TextInput style={styles.input} placeholder="e.g. Wardha" placeholderTextColor={theme.color.textFaint} value={newCityName} onChangeText={setNewCityName} />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>NearBaz UPI (VPA)</Text>
                    <TextInput style={styles.input} placeholder="e.g. nearbaz.wardha@upi" placeholderTextColor={theme.color.textFaint} autoCapitalize="none" autoCorrect={false} value={newCityUpiVpa} onChangeText={setNewCityUpiVpa} />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>Payee name (optional)</Text>
                    <TextInput style={styles.input} placeholder="NearBaz Wardha" placeholderTextColor={theme.color.textFaint} value={newCityUpiName} onChangeText={setNewCityUpiName} />
                  </View>
                </View>
                <View style={styles.modalActions}>
                  <Pressable style={({ pressed }) => [styles.primaryBtn, { flex: 1 }, pressed && styles.primaryBtnPressed]} onPress={wizardCreateCity} disabled={wizardBusy}>
                    {wizardBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create & Continue →</Text>}
                  </Pressable>
                  <Pressable style={styles.ghostBtn} onPress={() => { setShowAddWizard(false); resetWizard(); }}>
                    <Text style={styles.ghostBtnText}>Cancel</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>Assign Admin to {newCityName}</Text>
                <Text style={styles.modalHint}>Invite an admin for this city now, or skip and do it later from the Admins tab. A city needs at least one active admin to go live.</Text>
                <View style={styles.formCol}>
                  <View style={styles.field}>
                    <Text style={styles.label}>Admin phone number</Text>
                    <TextInput style={styles.input} placeholder="+91 98765..." placeholderTextColor={theme.color.textFaint} keyboardType="phone-pad" value={wizardAdminPhone} onChangeText={setWizardAdminPhone} />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>Admin email (optional)</Text>
                    <TextInput style={styles.input} placeholder="admin@nearbaz.in" placeholderTextColor={theme.color.textFaint} autoCapitalize="none" value={wizardAdminEmail} onChangeText={setWizardAdminEmail} />
                  </View>
                </View>
                <View style={[styles.card, { backgroundColor: theme.color.infoBg, borderColor: theme.color.info, gap: theme.space.xs }]}>
                  <Text style={[styles.meta, { color: theme.color.info, fontWeight: '700' }]}>
                    A city goes live only when it is <Text style={{ fontWeight: '900' }}>Enabled</Text> AND has an <Text style={{ fontWeight: '900' }}>Active admin</Text> assigned.
                  </Text>
                </View>
                <View style={styles.modalActions}>
                  <Pressable style={({ pressed }) => [styles.primaryBtn, { flex: 1 }, pressed && styles.primaryBtnPressed]} onPress={wizardInviteAdmin} disabled={wizardBusy}>
                    {wizardBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{wizardAdminPhone.trim() ? 'Invite & Finish' : 'Skip for now'}</Text>}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}



function CityDropdown({
  cities,
  value,
  onChange,
  disabled,
  showNone = true,
}: {
  cities: Array<{ id: string; name: string }>;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  showNone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = cities.find(c => c.id === value);
  const label = selected?.name ?? 'None';

  return (
    <View>
      <Pressable
        style={[styles.dropdown, disabled && styles.dropdownDisabled]}
        onPress={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
      >
        <Text style={[styles.dropdownValue, !selected && styles.dropdownPlaceholder]}>{label}</Text>
        <Text style={styles.dropdownChevron}>{open ? '▲' : '▼'}</Text>
      </Pressable>
      {open && (
        <View style={styles.dropdownList}>
          {showNone && (
            <Pressable
              style={[styles.dropdownItem, !value && styles.dropdownItemActive]}
              onPress={() => { onChange(null); setOpen(false); }}
            >
              <Text style={[styles.dropdownItemText, !value && styles.dropdownItemTextActive]}>None</Text>
            </Pressable>
          )}
          {cities.map(c => (
            <Pressable
              key={c.id}
              style={[styles.dropdownItem, value === c.id && styles.dropdownItemActive]}
              onPress={() => { onChange(c.id); setOpen(false); }}
            >
              <Text style={[styles.dropdownItemText, value === c.id && styles.dropdownItemTextActive]}>{c.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

type DeliveryTier = { maxKm: string; feePaise: string };

const DEFAULT_TIERS: DeliveryTier[] = [
  { maxKm: '2', feePaise: '2000' },
  { maxKm: '5', feePaise: '3500' },
  { maxKm: '10', feePaise: '5000' },
  { maxKm: '999', feePaise: '7000' },
];

function parseTiers(json: string | null | undefined): DeliveryTier[] {
  if (!json) return DEFAULT_TIERS.map(t => ({ ...t }));
  try {
    const arr: Array<{ maxKm: number; feePaise: number }> = JSON.parse(json);
    return arr.map(t => ({ maxKm: String(t.maxKm), feePaise: String(t.feePaise) }));
  } catch { return DEFAULT_TIERS.map(t => ({ ...t })); }
}

function DeliveryTierEditor({ city, onUpdate }: {
  city: City;
  onUpdate: (data: Partial<City>) => void;
}) {
  const [tiers, setTiers] = useState<DeliveryTier[]>(() => parseTiers(city.deliveryTiersJson));
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState(!city.deliveryTiersJson);

  function update(index: number, field: keyof DeliveryTier, value: string) {
    // Strip non-numeric characters (allow decimal point for km)
    const cleaned = field === 'maxKm'
      ? value.replace(/[^0-9.]/g, '')
      : value.replace(/[^0-9]/g, '');
    setTiers(prev => prev.map((t, i) => i === index ? { ...t, [field]: cleaned } : t));
    setDirty(true);
  }

  function addRow() {
    setTiers(prev => {
      const next = [...prev];
      // Insert before the last row (∞ catch-all) if it exists, otherwise append
      const lastIsInfinity = next.length > 0 && next[next.length - 1].maxKm === '999';
      const newRow: DeliveryTier = { maxKm: '', feePaise: '' };
      if (lastIsInfinity) {
        next.splice(next.length - 1, 0, newRow);
      } else {
        next.push(newRow);
      }
      return next;
    });
    setDirty(true);
  }

  function removeRow(index: number) {
    setTiers(prev => prev.filter((_, i) => i !== index));
    setDirty(true);
  }

  function save() {
    const parsed = tiers.map(t => ({
      maxKm: parseFloat(t.maxKm) || 0,
      feePaise: parseInt(t.feePaise, 10) || 0,
    })).filter(t => t.maxKm > 0 && t.feePaise > 0);
    if (!parsed.length) return;
    onUpdate({ deliveryTiersJson: JSON.stringify(parsed) });
    setDirty(false);
  }

  const hasConfig = !!city.deliveryTiersJson;

  return (
    <View style={styles.tierSection}>
      <Pressable style={styles.tierHeader} onPress={() => setExpanded(e => !e)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.citySettingLabel}>Per-km delivery fee tiers</Text>
          <Text style={styles.citySettingHint}>Riders cannot go online until these are saved</Text>
        </View>
        {!hasConfig && (
          <View style={[styles.badge, { backgroundColor: theme.color.criticalBg }]}>
            <Text style={[styles.badgeText, { color: theme.color.critical }]}>Not set</Text>
          </View>
        )}
        <Text style={styles.tierChevron}>{expanded ? '▲' : '▼'}</Text>
      </Pressable>
      {expanded && (
        <>
          <View style={styles.tierRow}>
            <Text style={[styles.tierCell, styles.tierHeadCell]}>Up to (km)</Text>
            <Text style={[styles.tierCell, styles.tierHeadCell]}>Fee (₹)</Text>
            <View style={{ width: 28 }} />
          </View>
          {tiers.map((tier, i) => (
            <View key={i} style={styles.tierRow}>
              <TextInput
                style={[styles.tierCell, styles.tierInput]}
                value={tier.maxKm === '999' ? '∞' : tier.maxKm}
                keyboardType="numeric"
                onChangeText={v => update(i, 'maxKm', v)}
                placeholder="km"
                editable={tier.maxKm !== '999'}
              />
              <TextInput
                style={[styles.tierCell, styles.tierInput]}
                value={tier.feePaise ? String(Math.round(parseInt(tier.feePaise, 10) / 100)) : ''}
                keyboardType="numeric"
                onChangeText={v => update(i, 'feePaise', String(Math.round((parseFloat(v.replace(/[^0-9]/g, '')) || 0) * 100)))}
                placeholder="₹"
              />
              <Pressable style={styles.tierRemoveBtn} onPress={() => removeRow(i)}>
                <Text style={styles.tierRemoveBtnText}>−</Text>
              </Pressable>
            </View>
          ))}
          <View style={styles.tierActions}>
            <Pressable style={styles.tierAddBtn} onPress={addRow}>
              <Text style={styles.tierAddBtnText}>+ Add tier</Text>
            </Pressable>
            {(dirty || !hasConfig) && (
              <Pressable style={styles.tierSaveBtn} onPress={save}>
                <Text style={styles.tierSaveBtnText}>Save Tiers</Text>
              </Pressable>
            )}
          </View>
        </>
      )}
    </View>
  );
}

function CityRow({ city, admins, busy, onToggle, onAddAdmin, onUpdate }: {
  city: City;
  admins: AdminInvite[];
  busy: boolean;
  onToggle: () => void;
  onAddAdmin: () => void;
  onUpdate: (data: Partial<City>) => void;
}) {
  const isLive = city.enabled && admins.length > 0;
  const isAlmost = city.enabled && admins.length === 0;
  const [editingUpi, setEditingUpi] = useState(false);
  const [upiDraft, setUpiDraft] = useState(city.collectionUpiVpa ?? '');
  const [upiSaving, setUpiSaving] = useState(false);
  const [upiError, setUpiError] = useState<string | null>(null);

  async function saveUpi() {
    setUpiSaving(true); setUpiError(null);
    try {
      await api.ownerUpsertCity(city.name, { enabled: city.enabled, collectionUpiVpa: upiDraft.trim() || undefined });
      city.collectionUpiVpa = upiDraft.trim() || null;
      setEditingUpi(false);
    } catch (e) { setUpiError((e as Error).message); }
    finally { setUpiSaving(false); }
  }
  return (
    <View style={[styles.card, !isLive && styles.cardWarning]}>
      <View style={styles.cityRowHead}>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={styles.name}>{city.name}</Text>
            <View style={[styles.badge, { backgroundColor: city.enabled ? theme.color.goodBg : theme.color.criticalBg }]}>
              <Text style={[styles.badgeText, { color: city.enabled ? theme.color.good : theme.color.critical }]}>
                {city.enabled ? 'Enabled' : 'Disabled'}
              </Text>
            </View>
            {isLive && (
              <View style={[styles.badge, { backgroundColor: theme.color.goodBg }]}>
                <Text style={[styles.badgeText, { color: theme.color.good }]}>Live</Text>
              </View>
            )}
          </View>
          {editingUpi ? (
            <View style={styles.upiEditRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={upiDraft}
                onChangeText={setUpiDraft}
                placeholder="e.g. nearbaz@upi"
                placeholderTextColor={theme.color.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
              <Pressable style={styles.upiSaveBtn} onPress={saveUpi} disabled={upiSaving}>
                <Text style={styles.upiSaveBtnText}>{upiSaving ? '…' : 'Save'}</Text>
              </Pressable>
              <Pressable style={styles.upiCancelBtn} onPress={() => { setEditingUpi(false); setUpiDraft(city.collectionUpiVpa ?? ''); }}>
                <Text style={styles.upiCancelBtnText}>✕</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => { setUpiDraft(city.collectionUpiVpa ?? ''); setEditingUpi(true); }}>
              <Text style={[styles.meta, { color: city.collectionUpiVpa ? theme.color.primary : theme.color.warning }]}>
                {city.collectionUpiVpa ? `UPI: ${city.collectionUpiVpa}` : 'No UPI set — tap to add'}
              </Text>
            </Pressable>
          )}
          {upiError ? <Text style={{ color: theme.color.critical, fontSize: 11 }}>{upiError}</Text> : null}
          {admins.length > 0 ? (
            <Text style={styles.meta}>{admins.length} admin{admins.length > 1 ? 's' : ''}: {admins.map(a => a.phone).join(', ')}</Text>
          ) : (
            <Text style={[styles.meta, { color: theme.color.warning }]}>No admin assigned — city won't go live</Text>
          )}
        </View>
        <View style={styles.cityRowActions}>
          <Pressable
            style={[styles.actionBtn, { backgroundColor: city.enabled ? theme.color.critical : theme.color.good }]}
            onPress={onToggle} disabled={busy}
          >
            <Text style={styles.actionBtnText}>{city.enabled ? 'Disable' : 'Enable'}</Text>
          </Pressable>
          {admins.length === 0 && (
            <Pressable style={[styles.actionBtn, { backgroundColor: theme.color.accent }]} onPress={onAddAdmin}>
              <Text style={styles.actionBtnText}>+ Admin</Text>
            </Pressable>
          )}
        </View>
      </View>
      {isAlmost && (
        <View style={styles.warnChip}>
          <Text style={styles.warnChipText}>Needs an active admin to go live</Text>
        </View>
      )}
      {/* Delivery settings */}
      <View style={styles.citySettings}>
        <View style={styles.citySettingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.citySettingLabel}>Customer → Shop max distance</Text>
            <Text style={styles.citySettingHint}>How far a customer can be from a shop to order</Text>
          </View>
          <View style={styles.radiusBtns}>
            {[5, 8, 10, 15, 20].map(km => (
              <Pressable key={km} style={[styles.radiusBtn, city.deliveryRadiusMeters === km * 1000 && styles.radiusBtnActive]}
                onPress={() => onUpdate({ deliveryRadiusMeters: km * 1000 })}>
                <Text style={[styles.radiusBtnText, city.deliveryRadiusMeters === km * 1000 && styles.radiusBtnTextActive]}>{km}km</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.citySettingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.citySettingLabel}>Rider check radius</Text>
            <Text style={styles.citySettingHint}>Rider must be online within this range of the shop for delivery to be available</Text>
          </View>
          <View style={styles.radiusBtns}>
            {[2, 3, 5, 8, 10].map(km => (
              <Pressable key={km} style={[styles.radiusBtn, city.riderCheckRadiusMeters === km * 1000 && styles.radiusBtnActive]}
                onPress={() => onUpdate({ riderCheckRadiusMeters: km * 1000 })}>
                <Text style={[styles.radiusBtnText, city.riderCheckRadiusMeters === km * 1000 && styles.radiusBtnTextActive]}>{km}km</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <DeliveryTierEditor city={city} onUpdate={onUpdate} />
        <SurchargeEditor city={city} onUpdate={onUpdate} />
        <BulkRadiusEditor city={city} onUpdate={onUpdate} />
        <CodRulesEditor city={city} onUpdate={onUpdate} />
        <OperationalEditor city={city} onUpdate={onUpdate} />
        <FeeCommissionEditor city={city} onUpdate={onUpdate} />
        <ReferralEditor city={city} onUpdate={onUpdate} />
      </View>
    </View>
  );
}

function SurchargeEditor({
  city,
  onUpdate,
}: {
  city: City;
  onUpdate: (data: Partial<City>) => void;
}) {
  const current = city.multiShopSurchargePaise ?? 1000;
  const [draft, setDraft] = useState(String(Math.round(current / 100)));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const rupees = parseInt(draft, 10);
    if (isNaN(rupees) || rupees < 0) { setErr('Enter a valid amount in ₹'); return; }
    setSaving(true); setErr(null);
    try {
      await api.ownerUpsertCity(city.name, { multiShopSurchargePaise: rupees * 100 });
      onUpdate({ multiShopSurchargePaise: rupees * 100 });
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: '#6B7280', marginBottom: 6 }}>
        MULTI-SHOP SURCHARGE (per extra stop)
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 14, color: '#374151' }}>₹</Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          keyboardType="numeric"
          style={{ borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, width: 80, fontSize: 14, color: '#111827' }}
        />
        <Pressable
          onPress={save}
          disabled={saving}
          style={{ backgroundColor: '#7C3AED', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 8, opacity: saving ? 0.6 : 1 }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
        <Text style={{ fontSize: 12, color: '#9CA3AF' }}>Current: ₹{Math.round(current / 100)}/stop</Text>
      </View>
      {err ? <Text style={{ color: '#DC2626', fontSize: 12, marginTop: 4 }}>{err}</Text> : null}
    </View>
  );
}

function BulkRadiusEditor({ city, onUpdate }: {
  city: City;
  onUpdate: (data: Partial<City>) => void;
}) {
  const options = [500, 1000, 2000, 3000, 5000];
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: '#6B7280', marginBottom: 6 }}>
        NEARBY SHOPS RADIUS (bulk order panel)
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {options.map((m) => {
          const active = (city.bulkShopRadiusMeters ?? 1000) === m;
          return (
            <Pressable
              key={m}
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1.5, borderColor: active ? theme.color.accent : theme.color.borderStrong, backgroundColor: active ? theme.color.infoBg : theme.color.surface }}
              onPress={async () => {
                try {
                  await api.ownerUpsertCity(city.name, { bulkShopRadiusMeters: m });
                  onUpdate({ bulkShopRadiusMeters: m });
                } catch { /* ignore */ }
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: active ? theme.color.accent : theme.color.textMuted }}>
                {m >= 1000 ? `${m / 1000}km` : `${m}m`}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function CodRulesEditor({ city, onUpdate }: {
  city: City;
  onUpdate: (data: Partial<City>) => void;
}) {
  const fields: Array<{ key: keyof City; label: string; hint: string; min: number; max: number }> = [
    { key: 'codMinOrderPaise', label: 'Min order for COD (₹)', hint: '0 = no minimum', min: 0, max: 100000 },
    { key: 'codMaxPerDay', label: 'Max COD orders/day', hint: '0 = unlimited', min: 0, max: 100 },
    { key: 'codCancelBlockAfter', label: 'Block COD after N cancels', hint: '0 = disabled', min: 0, max: 20 },
    { key: 'codCancelWindowDays', label: 'Cancel check window (days)', hint: '30 = last 30 days', min: 1, max: 365 },
  ];
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: '#6B7280', marginBottom: 6 }}>COD RULES</Text>
      {fields.map(({ key, label, hint }) => {
        const [draft, setDraft] = useState(String(key === 'codMinOrderPaise' ? Math.round((city[key] as number) / 100) : city[key] ?? 0));
        const [saving, setSaving] = useState(false);
        async function save() {
          let val = parseInt(draft, 10);
          if (isNaN(val)) return;
          if (key === 'codMinOrderPaise') val = val * 100;
          setSaving(true);
          try {
            await api.ownerUpsertCity(city.name, { [key]: val });
            onUpdate({ [key]: val });
          } catch { /* ignore */ } finally { setSaving(false); }
        }
        return (
          <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: '#374151', fontWeight: '600' }}>{label}</Text>
              <Text style={{ fontSize: 11, color: '#9CA3AF' }}>{hint}</Text>
            </View>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              keyboardType="numeric"
              style={{ width: 64, borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontSize: 13, color: theme.color.text, textAlign: 'center', backgroundColor: theme.color.surface }}
            />
            <Pressable onPress={save} disabled={saving} style={{ backgroundColor: theme.color.accent, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{saving ? '…' : 'Set'}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function SectionLabel({ title }: { title: string }) {
  return <Text style={{ fontSize: 12, fontWeight: '700', color: '#6B7280', marginBottom: 6, marginTop: 12 }}>{title}</Text>;
}

function NumericRow({
  label, hint, value, onSave, toDisplay = v => String(v), fromDisplay = v => parseInt(v, 10),
}: {
  label: string; hint: string; value: number;
  onSave: (v: number) => Promise<void>;
  toDisplay?: (v: number) => string;
  fromDisplay?: (s: string) => number;
}) {
  const [draft, setDraft] = useState(toDisplay(value));
  const [saving, setSaving] = useState(false);
  async function save() {
    const val = fromDisplay(draft);
    if (isNaN(val)) return;
    setSaving(true);
    try { await onSave(val); } catch { /* ignore */ } finally { setSaving(false); }
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 12, color: '#374151', fontWeight: '600' }}>{label}</Text>
        <Text style={{ fontSize: 11, color: '#9CA3AF' }}>{hint}</Text>
      </View>
      <TextInput value={draft} onChangeText={setDraft} keyboardType="decimal-pad"
        style={{ width: 72, borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontSize: 13, color: theme.color.text, textAlign: 'center', backgroundColor: theme.color.surface }} />
      <Pressable onPress={save} disabled={saving} style={{ backgroundColor: theme.color.accent, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{saving ? '…' : 'Set'}</Text>
      </Pressable>
    </View>
  );
}

function ToggleRow({ label, hint, value, onToggle }: { label: string; hint: string; value: boolean; onToggle: (v: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try { await onToggle(!value); } catch { /* ignore */ } finally { setBusy(false); }
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 12, color: '#374151', fontWeight: '600' }}>{label}</Text>
        <Text style={{ fontSize: 11, color: '#9CA3AF' }}>{hint}</Text>
      </View>
      <Pressable onPress={toggle} disabled={busy}
        style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6, borderWidth: 1,
          backgroundColor: value ? theme.color.goodBg : theme.color.surfaceAlt,
          borderColor: value ? theme.color.good : theme.color.borderStrong }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: value ? theme.color.good : theme.color.textMuted }}>
          {busy ? '…' : value ? 'ON' : 'OFF'}
        </Text>
      </Pressable>
    </View>
  );
}

// ─── Operational config editor ────────────────────────────────────────────────

function OperationalEditor({ city, onUpdate }: { city: City; onUpdate: (d: Partial<City>) => void }) {
  async function save(key: keyof City, val: number) {
    await api.ownerUpsertCity(city.name, { [key]: val });
    onUpdate({ [key]: val });
  }
  async function toggleRider(val: boolean) {
    await api.ownerUpsertCity(city.name, { requireRiderForDelivery: val });
    onUpdate({ requireRiderForDelivery: val });
  }
  return (
    <View style={{ marginTop: 12 }}>
      <SectionLabel title="OPERATIONAL CONFIG" />
      <ToggleRow label="Require rider for delivery" hint="Show shops only when a rider is online nearby" value={city.requireRiderForDelivery} onToggle={toggleRider} />
      <NumericRow label="Auto-cancel timeout (min)" hint="Cancel if shop doesn't respond" value={city.autoCancelMinutes} onSave={v => save('autoCancelMinutes', v)} />
      <NumericRow label="Shop reminder interval (min)" hint="Re-notify shop of unanswered order" value={city.shopReminderMinutes} onSave={v => save('shopReminderMinutes', v)} />
      <NumericRow label="Rider offer window (sec)" hint="How long a rider's offer stays open" value={city.riderOfferWindowSec} onSave={v => save('riderOfferWindowSec', v)} />
      <NumericRow label="Max active orders per rider" hint="Cap on concurrent rider orders" value={city.maxActiveOrdersPerRider} onSave={v => save('maxActiveOrdersPerRider', v)} />
      <NumericRow label="Stale rider threshold (min)" hint="Release RIDER_ASSIGNED after this" value={city.staleRiderMinutes} onSave={v => save('staleRiderMinutes', v)} />
      <NumericRow label="Nearby shops radius (m)" hint="Default customer discovery radius" value={city.nearbyShopsRadiusMeters} onSave={v => save('nearbyShopsRadiusMeters', v)} />
      <NumericRow label="COD window (hours)" hint="Rolling window for COD order count" value={city.codWindowHours} onSave={v => save('codWindowHours', v)} />
    </View>
  );
}

// ─── Fee / commission config editor ──────────────────────────────────────────

function FeeCommissionEditor({ city, onUpdate }: { city: City; onUpdate: (d: Partial<City>) => void }) {
  async function save(key: keyof City, val: number) {
    await api.ownerUpsertCity(city.name, { [key]: val });
    onUpdate({ [key]: val });
  }
  return (
    <View style={{ marginTop: 12 }}>
      <SectionLabel title="FEES & COMMISSION" />
      <NumericRow label="Platform fee (₹)" hint="Flat fee added to every order" value={city.platformFeePaise}
        toDisplay={v => String(Math.round(v / 100))} fromDisplay={s => Math.round(parseFloat(s) * 100)}
        onSave={v => save('platformFeePaise', v)} />
      <NumericRow label="Default commission (%)" hint="Applied to new shops on approval" value={city.defaultCommissionRate}
        toDisplay={v => String(Math.round(v * 100))} fromDisplay={s => parseFloat(s) / 100}
        onSave={v => save('defaultCommissionRate', v)} />
      <NumericRow label="Default credit limit (₹)" hint="Auto-pause threshold for new shops" value={city.defaultCreditLimitPaise}
        toDisplay={v => String(Math.round(v / 100))} fromDisplay={s => Math.round(parseFloat(s) * 100)}
        onSave={v => save('defaultCreditLimitPaise', v)} />
      <NumericRow label="Commission holiday (days)" hint="Days commission-free after approval" value={city.commissionHolidayDays} onSave={v => save('commissionHolidayDays', v)} />
      <NumericRow label="Onboarding fee (₹)" hint="One-time fee charged on shop approval" value={city.onboardingFeePaise}
        toDisplay={v => String(Math.round(v / 100))} fromDisplay={s => Math.round(parseFloat(s) * 100)}
        onSave={v => save('onboardingFeePaise', v)} />
    </View>
  );
}

// ─── Referral / coin config editor ───────────────────────────────────────────

function ReferralEditor({ city, onUpdate }: { city: City; onUpdate: (d: Partial<City>) => void }) {
  async function save(key: keyof City, val: number) {
    await api.ownerUpsertCity(city.name, { [key]: val });
    onUpdate({ [key]: val });
  }
  return (
    <View style={{ marginTop: 12 }}>
      <SectionLabel title="REFERRAL COINS" />
      <NumericRow label="Customer referral coins" hint="Coins each side earns on first delivery" value={city.referralCustomerCoins} onSave={v => save('referralCustomerCoins', v)} />
      <NumericRow label="Shop referral coins" hint="Coins for shop referrer on first order" value={city.referralShopCoins} onSave={v => save('referralShopCoins', v)} />
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isActive = status === STATUS_ACTIVE;
  const isPending = status === STATUS_PENDING;
  const bg = isActive ? theme.color.goodBg : isPending ? theme.color.warningBg : theme.color.infoBg;
  const fg = isActive ? theme.color.good : isPending ? theme.color.warning : theme.color.info;
  const label = isPending ? 'Pending approval' : isActive ? 'Active' : status;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { padding: theme.space.xl, gap: theme.space.lg, paddingBottom: theme.space.xxxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },

  pageHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: theme.space.xl, paddingTop: theme.space.xl, paddingBottom: theme.space.md,
  },
  h1: { fontSize: theme.font.h1, fontWeight: '800', color: theme.color.text },
  sub: { fontSize: theme.font.body, color: theme.color.textMuted, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: theme.space.sm },
  refresh: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.borderStrong, backgroundColor: theme.color.surface },
  refreshText: { color: theme.color.text, fontWeight: '600', fontSize: theme.font.small },
  addBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, borderRadius: theme.radius.md, backgroundColor: theme.color.accent },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.small },

  // Tabs
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.color.border, paddingHorizontal: theme.space.xl, backgroundColor: theme.color.surface },
  tabItem: { paddingVertical: theme.space.md, paddingHorizontal: theme.space.lg, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabItemActive: { borderBottomColor: theme.color.accent },
  tabText: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.textMuted },
  tabTextActive: { color: theme.color.accent },

  // Cards
  card: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, padding: theme.space.lg, gap: theme.space.md, ...theme.shadow.card },
  cardWarning: { borderColor: theme.color.warning },
  cardTitle: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  cardHint: { fontSize: theme.font.small, color: theme.color.textMuted, lineHeight: 19 },

  // City row
  cityRowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
  cityRowActions: { flexDirection: 'row', gap: theme.space.sm },
  warnChip: { alignSelf: 'flex-start', backgroundColor: theme.color.warningBg, borderRadius: theme.radius.pill, paddingHorizontal: theme.space.md, paddingVertical: theme.space.xs },
  warnChipText: { fontSize: theme.font.tiny, color: theme.color.warning, fontWeight: '700' },
  citySettings: { borderTopWidth: 1, borderTopColor: theme.color.border, paddingTop: theme.space.sm, gap: theme.space.sm },
  citySettingRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
  citySettingLabel: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  citySettingHint: { fontSize: theme.font.tiny, color: theme.color.textMuted, marginTop: 2 },
  radiusBtns: { flexDirection: 'row', gap: theme.space.xs },
  radiusBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  radiusBtnActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  radiusBtnText: { fontSize: theme.font.tiny, fontWeight: '700', color: theme.color.textMuted },
  radiusBtnTextActive: { color: '#fff' },

  // Delivery tier editor
  tierSection: { borderTopWidth: 1, borderTopColor: theme.color.border, paddingTop: theme.space.sm, gap: theme.space.xs },
  tierHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  tierChevron: { fontSize: theme.font.small, color: theme.color.textMuted },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  tierCell: { flex: 1, fontSize: theme.font.small, color: theme.color.text },
  tierHeadCell: { fontWeight: '700', color: theme.color.textMuted, paddingBottom: 2 },
  tierInput: { borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.sm, paddingHorizontal: theme.space.sm, paddingVertical: 6, backgroundColor: theme.color.bg },
  tierRemoveBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.color.criticalBg, alignItems: 'center', justifyContent: 'center' },
  tierRemoveBtnText: { color: theme.color.critical, fontSize: 18, fontWeight: '700', lineHeight: 20 },
  tierActions: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.xs },
  tierAddBtn: { flex: 1, borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.md, paddingVertical: theme.space.sm, alignItems: 'center' },
  tierAddBtnText: { color: theme.color.accent, fontWeight: '700', fontSize: theme.font.small },
  tierSaveBtn: { flex: 1, backgroundColor: theme.color.primary, borderRadius: theme.radius.md, paddingVertical: theme.space.sm, alignItems: 'center' },
  tierSaveBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.small },

  // City offer templates
  offerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, paddingVertical: theme.space.xs, borderTopWidth: 1, borderTopColor: theme.color.border },
  offerRowTitle: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  offerRowMeta: { fontSize: 11, color: theme.color.textMuted, marginTop: 2 },
  offerForm: { gap: theme.space.sm, paddingTop: theme.space.sm, borderTopWidth: 1, borderTopColor: theme.color.border },
  typeChip: { flex: 1, paddingVertical: 6, paddingHorizontal: 8, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center' },
  typeChipActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  typeChipText: { fontSize: 10, fontWeight: '700', color: theme.color.textMuted },
  typeChipTextActive: { color: '#fff' },
  offerError: { fontSize: theme.font.small, color: theme.color.critical },
  offerGlobalNote: { fontSize: 10, color: theme.color.info, marginTop: 2 },

  // Admin card
  adminCardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
  adminAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.accent, alignItems: 'center', justifyContent: 'center' },
  adminAvatarText: { fontSize: theme.font.small, fontWeight: '800', color: '#fff' },
  adminActions: { flexDirection: 'row', gap: theme.space.sm },

  // Shared
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, flexWrap: 'wrap' },
  name: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  meta: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 3 },
  upiEditRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, marginTop: 4 },
  upiSaveBtn: { backgroundColor: theme.color.primary, borderRadius: theme.radius.md, paddingHorizontal: theme.space.md, paddingVertical: 7, alignItems: 'center' },
  upiSaveBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.small },
  upiCancelBtn: { backgroundColor: theme.color.surfaceAlt, borderRadius: theme.radius.md, paddingHorizontal: theme.space.sm, paddingVertical: 7 },
  upiCancelBtnText: { color: theme.color.textMuted, fontSize: theme.font.small, fontWeight: '700' },
  badge: { paddingVertical: 3, paddingHorizontal: theme.space.sm, borderRadius: theme.radius.pill },
  badgeText: { fontSize: theme.font.tiny, fontWeight: '700' },
  formRow: { flexDirection: 'row', gap: theme.space.md, flexWrap: 'wrap' },
  formCol: { gap: theme.space.md },
  field: { flexGrow: 1, flexBasis: 220, gap: theme.space.xs },
  label: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  input: { borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md, padding: theme.space.md, fontSize: theme.font.body, color: theme.color.text, backgroundColor: theme.color.surfaceAlt },
  primaryBtn: { alignSelf: 'flex-start', backgroundColor: theme.color.primary, borderRadius: theme.radius.md, paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl, alignItems: 'center', minWidth: 160 },
  primaryBtnPressed: { backgroundColor: theme.color.primaryDark },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.body },
  ghostBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg },
  ghostBtnText: { color: theme.color.textMuted, fontWeight: '600', fontSize: theme.font.small },
  editorActions: { flexDirection: 'row', gap: theme.space.md, alignItems: 'center' },
  actions: { flexDirection: 'row', gap: theme.space.sm },
  actionBtn: { paddingVertical: theme.space.sm, paddingHorizontal: theme.space.lg, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', minWidth: 80 },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.small },
  cityPicker: { gap: theme.space.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, alignItems: 'center', marginTop: theme.space.xs },
  chip: { paddingVertical: theme.space.xs, paddingHorizontal: theme.space.md, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.borderStrong, backgroundColor: theme.color.surfaceAlt },
  chipSelected: { borderColor: theme.color.accent, backgroundColor: theme.color.infoBg },
  chipText: { fontSize: theme.font.small, color: theme.color.textMuted, fontWeight: '600' },
  chipTextSelected: { color: theme.color.accent },

  // Dropdown
  dropdown: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md,
    padding: theme.space.md, backgroundColor: theme.color.surfaceAlt,
  },
  dropdownDisabled: { opacity: 0.5 },
  dropdownValue: { fontSize: theme.font.body, color: theme.color.text, fontWeight: '500' },
  dropdownPlaceholder: { color: theme.color.textFaint },
  dropdownChevron: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  dropdownList: {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 99,
    backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.md, marginTop: 2,
    ...theme.shadow.card,
  },
  dropdownItem: { paddingVertical: theme.space.md, paddingHorizontal: theme.space.md, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  dropdownItemActive: { backgroundColor: theme.color.infoBg },
  dropdownItemText: { fontSize: theme.font.body, color: theme.color.text },
  dropdownItemTextActive: { color: theme.color.accent, fontWeight: '700' },

  // Wizard modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },
  modalCard: { backgroundColor: theme.color.bg, borderRadius: theme.radius.lg, padding: theme.space.xl, gap: theme.space.lg, width: '100%', maxWidth: 480, ...theme.shadow.card },
  modalTitle: { fontSize: theme.font.h2, fontWeight: '800', color: theme.color.text },
  modalHint: { fontSize: theme.font.small, color: theme.color.textMuted, lineHeight: 19 },
  modalActions: { flexDirection: 'row', gap: theme.space.md, alignItems: 'center' },
  wizardSteps: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  wizardStep: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs, opacity: 0.4 },
  wizardStepActive: { opacity: 1 },
  wizardStepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: theme.color.borderStrong, alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: theme.font.small, fontWeight: '800', color: theme.color.textMuted, overflow: 'hidden' },
  wizardStepNumActive: { backgroundColor: theme.color.accent, color: '#fff' },
  wizardStepLabel: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  wizardStepLine: { flex: 1, height: 1, backgroundColor: theme.color.border },

  empty: { alignItems: 'center', padding: theme.space.xxxl, backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, borderStyle: 'dashed', gap: theme.space.xs },
  emptyTitle: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  emptyBody: { fontSize: theme.font.body, color: theme.color.textMuted, textAlign: 'center' },
  error: { color: theme.color.critical, fontSize: theme.font.body },
  banner: { backgroundColor: theme.color.primary, paddingVertical: theme.space.md, paddingHorizontal: theme.space.xl },
  bannerText: { color: '#fff', fontWeight: '600', fontSize: theme.font.small },
  notice: { maxWidth: 420, padding: theme.space.xl, borderRadius: theme.radius.lg, backgroundColor: theme.color.criticalBg, borderWidth: 1, borderColor: '#FCA5A5', gap: theme.space.sm },
  noticeTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.critical },
  noticeBody: { fontSize: theme.font.body, color: theme.color.text, lineHeight: 21 },
});
