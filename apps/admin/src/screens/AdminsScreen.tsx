import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '@passwaala/api-client';
import { api } from '../api';
import { theme } from '../theme';
import { useLang } from '../i18n/LanguageContext';
import type { Strings } from '../i18n/strings';

/** Row returned by GET /owner/admins. */
interface AdminInvite {
  inviteId: string;
  userId: string;
  phone: string | null;
  email: string | null;
  role: string;
  status: string;
  createdAt: string;
  city: { id: string; name: string } | null;
}

const STATUS_PENDING = 'PENDING_OWNER_APPROVAL';
const STATUS_ACTIVE = 'ACTIVE';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/**
 * AdminsScreen — OWNER-only admin management. Lists every admin invite with its
 * role + status, lets the owner invite a new admin (phone + optional email),
 * and approve pending invites or revoke active admins. The list refreshes after
 * each action. A 403 (a non-owner reaching this screen) shows a clear notice.
 */
export function AdminsScreen() {
  const { t } = useLang();
  const [admins, setAdmins] = useState<AdminInvite[]>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const [adminData, cityData] = await Promise.all([
        api.ownerListAdmins(),
        api.ownerListCities(),
      ]);
      setAdmins(adminData as AdminInvite[]);
      setCities(cityData);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function flash(msg: string) {
    setBanner(msg);
    setTimeout(() => setBanner(null), 3500);
  }

  async function invite() {
    if (!phone.trim()) {
      flash(t.admins.phoneRequired);
      return;
    }
    setInviting(true);
    try {
      await api.ownerInviteAdmin({
        phone: phone.trim(),
        email: email.trim() ? email.trim() : undefined,
      });
      flash(t.admins.invitedFlash(phone.trim()));
      setPhone('');
      setEmail('');
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else flash(t.admins.inviteFailed((e as Error).message));
    } finally {
      setInviting(false);
    }
  }

  async function approve(row: AdminInvite) {
    setBusyId(row.inviteId);
    try {
      await api.ownerApproveAdmin(row.inviteId);
      flash(t.admins.approvedFlash(row.phone ?? row.email ?? t.admins.adminDefault));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else flash(t.admins.approveFailed((e as Error).message));
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(row: AdminInvite) {
    setBusyId(row.inviteId);
    try {
      await api.ownerRevokeAdmin(row.inviteId);
      flash(t.admins.revokedFlash(row.phone ?? row.email ?? t.admins.adminDefault));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else flash(t.admins.revokeFailed((e as Error).message));
    } finally {
      setBusyId(null);
    }
  }

  async function assignCity(row: AdminInvite, cityId: string | null) {
    setAssigningId(row.inviteId);
    try {
      await api.ownerAssignAdminCity(row.inviteId, cityId);
      flash(cityId
        ? t.admins.cityAssignedFlash(cities.find((c) => c.id === cityId)?.name ?? t.admins.cityDefault, row.phone ?? t.admins.adminDefault)
        : t.admins.cityClearedFlash(row.phone ?? t.admins.adminDefault)
      );
      await load();
    } catch (e) {
      flash(t.admins.cityAssignFailed((e as Error).message));
    } finally {
      setAssigningId(null);
    }
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
          <Text style={styles.noticeTitle}>{t.admins.ownerOnly}</Text>
          <Text style={styles.noticeBody}>
            {t.admins.ownerOnlyBody}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {banner ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{banner}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.h1}>{t.admins.title}</Text>
            <Text style={styles.sub}>
              {t.admins.subtitle(admins.length)}
            </Text>
          </View>
          <Pressable style={styles.refresh} onPress={load}>
            <Text style={styles.refreshText}>{t.common.refresh}</Text>
          </Pressable>
        </View>

        {/* Invite form */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t.admins.inviteTitle}</Text>
          <Text style={styles.cardHint}>
            {t.admins.inviteHint}
          </Text>
          <View style={styles.formRow}>
            <View style={styles.field}>
              <Text style={styles.label}>{t.admins.phoneLabel}</Text>
              <TextInput
                style={styles.input}
                placeholder="10-digit mobile number"
                placeholderTextColor={theme.color.textFaint}
                keyboardType="phone-pad"
                maxLength={10}
                value={phone}
                onChangeText={t => setPhone(t.replace(/\D/g, '').slice(0, 10))}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t.admins.emailLabel}</Text>
              <TextInput
                style={styles.input}
                placeholder={t.admins.emailPlaceholder}
                placeholderTextColor={theme.color.textFaint}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />
            </View>
          </View>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
            onPress={invite}
            disabled={inviting}
          >
            {inviting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>{t.admins.inviteAdmin}</Text>
            )}
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {admins.length === 0 && !error ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t.admins.noAdmins}</Text>
            <Text style={styles.emptyBody}>{t.admins.noAdminsBody}</Text>
          </View>
        ) : null}

        <View style={styles.list}>
          {admins.map((row) => {
            const busy = busyId === row.inviteId;
            const assigning = assigningId === row.inviteId;
            const isPending = row.status === STATUS_PENDING;
            const isActive = row.status === STATUS_ACTIVE;
            return (
              <View key={row.inviteId} style={styles.card}>
                <View style={styles.rowHead}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.titleRow}>
                      <Text style={styles.name}>{row.phone ?? '—'}</Text>
                      <StatusBadge status={row.status} t={t} />
                    </View>
                    <Text style={styles.meta}>
                      {row.email ?? t.admins.noEmail} · {row.role} · {t.admins.invited(formatDate(row.createdAt))}
                    </Text>
                    <Text style={[styles.meta, { marginTop: theme.space.xs }]}>
                      {row.city ? t.admins.cityAssigned(row.city.name) : t.admins.noCityAssigned}
                    </Text>
                  </View>
                </View>

                {isActive && (
                  <View style={styles.cityPicker}>
                    <Text style={styles.label}>{t.admins.assignCity}</Text>
                    <View style={styles.chipRow}>
                      {cities.map((c) => {
                        const selected = row.city?.id === c.id;
                        return (
                          <Pressable
                            key={c.id}
                            style={[styles.chip, selected && styles.chipSelected]}
                            onPress={() => !assigning && assignCity(row, selected ? null : c.id)}
                            disabled={assigning}
                          >
                            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                              {c.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                      {assigning && <ActivityIndicator color={theme.color.accent} style={{ marginLeft: theme.space.sm }} />}
                    </View>
                  </View>
                )}

                <View style={styles.actions}>
                  {isPending ? (
                    <ActionButton
                      label={t.admins.approve}
                      tone="good"
                      busy={busy}
                      onPress={() => approve(row)}
                    />
                  ) : null}
                  {isActive ? (
                    <ActionButton
                      label={t.admins.revoke}
                      tone="critical"
                      busy={busy}
                      onPress={() => revoke(row)}
                    />
                  ) : null}
                  {!isPending && !isActive ? (
                    <Text style={styles.metaFaint}>{t.admins.noActions}</Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function StatusBadge({ status, t }: { status: string; t: Strings }) {
  const isPending = status === STATUS_PENDING;
  const isActive = status === STATUS_ACTIVE;
  const bg = isActive ? theme.color.goodBg : isPending ? theme.color.warningBg : theme.color.infoBg;
  const fg = isActive ? theme.color.good : isPending ? theme.color.warning : theme.color.info;
  const label = isPending ? t.admins.pendingApproval : isActive ? t.admins.active : status;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

type BtnTone = 'good' | 'critical';

function ActionButton({
  label,
  tone,
  onPress,
  busy,
}: {
  label: string;
  tone: BtnTone;
  onPress: () => void;
  busy?: boolean;
}) {
  const bg = tone === 'good' ? theme.color.good : theme.color.critical;
  return (
    <Pressable style={[styles.actionBtn, { backgroundColor: bg }]} onPress={onPress} disabled={busy}>
      {busy ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.actionBtnText}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { padding: theme.space.xl, gap: theme.space.lg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space.xl,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  h1: { fontSize: theme.font.h1, fontWeight: '800', color: theme.color.text },
  sub: { fontSize: theme.font.body, color: theme.color.textMuted, marginTop: 2 },
  refresh: {
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.lg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    backgroundColor: theme.color.surface,
  },
  refreshText: { color: theme.color.text, fontWeight: '600', fontSize: theme.font.small },
  list: { gap: theme.space.lg },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.lg,
    gap: theme.space.md,
    ...theme.shadow.card,
  },
  cardTitle: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  cardHint: { fontSize: theme.font.small, color: theme.color.textMuted },
  formRow: { flexDirection: 'row', gap: theme.space.md, flexWrap: 'wrap' },
  field: { flexGrow: 1, flexBasis: 220, gap: theme.space.xs },
  label: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  input: {
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    fontSize: theme.font.body,
    color: theme.color.text,
    backgroundColor: theme.color.surfaceAlt,
  },
  primaryBtn: {
    alignSelf: 'flex-start',
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.xl,
    alignItems: 'center',
    minWidth: 160,
  },
  primaryBtnPressed: { backgroundColor: theme.color.primaryDark },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.body },
  rowHead: { flexDirection: 'row' },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    flexWrap: 'wrap',
  },
  name: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  meta: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space.xs },
  metaFaint: { fontSize: theme.font.small, color: theme.color.textFaint },
  actions: { flexDirection: 'row', gap: theme.space.sm, flexWrap: 'wrap' },
  actionBtn: {
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.lg,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 96,
  },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.small },
  cityPicker: { gap: theme.space.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, alignItems: 'center' },
  chip: {
    paddingVertical: theme.space.xs,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    backgroundColor: theme.color.surfaceAlt,
  },
  chipSelected: {
    borderColor: theme.color.accent,
    backgroundColor: theme.color.infoBg,
  },
  chipText: { fontSize: theme.font.small, color: theme.color.textMuted, fontWeight: '600' },
  chipTextSelected: { color: theme.color.accent },
  badge: {
    paddingVertical: 3,
    paddingHorizontal: theme.space.sm,
    borderRadius: theme.radius.pill,
  },
  badgeText: { fontSize: theme.font.tiny, fontWeight: '700' },
  empty: {
    alignItems: 'center',
    padding: theme.space.xxxl,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderStyle: 'dashed',
    gap: theme.space.xs,
  },
  emptyTitle: { fontSize: theme.font.h3, fontWeight: '700', color: theme.color.text },
  emptyBody: { fontSize: theme.font.body, color: theme.color.textMuted },
  error: { color: theme.color.critical, fontSize: theme.font.body },
  banner: {
    backgroundColor: theme.color.primary,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.xl,
  },
  bannerText: { color: '#fff', fontWeight: '600', fontSize: theme.font.small },
  notice: {
    maxWidth: 420,
    padding: theme.space.xl,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.criticalBg,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    gap: theme.space.sm,
  },
  noticeTitle: { fontSize: theme.font.h3, fontWeight: '800', color: theme.color.critical },
  noticeBody: { fontSize: theme.font.body, color: theme.color.text, lineHeight: 21 },
});
