import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, updateName } from '../api';
import type { Account, Address, ReferralInfo } from '../types';
import { AddressForm } from '../components/AddressForm';
import { LanguagePicker } from '../components/LanguagePicker';
import { shadow, theme } from '../theme';
import { Badge, Button, CoinChip, ErrorState, Loading } from '../ui';
import { useLang } from '../i18n/LanguageContext';

/**
 * ProfileScreen — account (plan → Profile). Shows me() details with an editable
 * display name (PATCH /account/me), a saved-addresses section with add / edit /
 * delete, a Logout action, and account deletion (deleteAccount) behind a
 * confirm. On web, Alert has no buttons so we use in-app confirm modals.
 */
export function ProfileScreen({ onLogout }: { onLogout: () => void }) {
  const { t } = useLang();
  const [account, setAccount] = useState<Account | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [referral, setReferral] = useState<ReferralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Name editing
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Referral
  const [codeDraft, setCodeDraft] = useState('');
  const [applyingCode, setApplyingCode] = useState(false);
  const [referralNotice, setReferralNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Address editing
  const [addingAddress, setAddingAddress] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [deletingAddressId, setDeletingAddressId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [me, addrs, ref] = await Promise.all([
        api.me() as Promise<Account>,
        api.addresses() as Promise<Address[]>,
        api.referralMe().catch(() => null) as Promise<ReferralInfo | null>,
      ]);
      setAccount(me);
      setAddresses(addrs);
      setReferral(ref);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reloadAddresses = useCallback(async () => {
    try {
      const addrs = (await api.addresses()) as Address[];
      setAddresses(addrs);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  function startEditName() {
    setNameDraft(account?.name ?? '');
    setEditingName(true);
    setError(null);
  }

  async function saveName() {
    const name = nameDraft.trim();
    if (!name) {
      setError(t.profile.enterName);
      return;
    }
    setSavingName(true);
    setError(null);
    try {
      await updateName(name);
      setAccount((prev) => (prev ? { ...prev, name } : prev));
      setEditingName(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingName(false);
    }
  }

  async function shareReferral() {
    const code = referral?.referralCode;
    if (!code) return;
    const message = `Join me on PassWaala! Use my referral code ${code} to get started. Jo chahiye, paas mein mil jayega.`;
    // Web: prefer the clipboard with a brief "Copied!" confirmation. Native:
    // use the OS share sheet.
    if (Platform.OS === 'web') {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          return;
        }
      } catch {
        /* fall through to share */
      }
    }
    try {
      await Share.share({ message });
    } catch {
      /* user dismissed — no-op */
    }
  }

  async function applyCode() {
    const code = codeDraft.trim();
    if (!code) {
      setReferralNotice(t.profile.enterCode);
      return;
    }
    setApplyingCode(true);
    setReferralNotice(null);
    try {
      await api.applyReferral(code);
      setCodeDraft('');
      setReferralNotice(t.profile.codeApplied);
      // Refresh coin balance + referral list to reflect the reward.
      const [me, ref] = await Promise.all([
        api.me().catch(() => null) as Promise<Account | null>,
        api.referralMe().catch(() => null) as Promise<ReferralInfo | null>,
      ]);
      if (me) setAccount(me);
      if (ref) setReferral(ref);
    } catch (e) {
      setReferralNotice((e as Error).message);
    } finally {
      setApplyingCode(false);
    }
  }

  async function removeAddress(id: string) {
    setDeletingAddressId(id);
    setError(null);
    try {
      await api.deleteAddress(id);
      await reloadAddresses();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingAddressId(null);
    }
  }

  async function doDelete() {
    setDeleting(true);
    try {
      await api.deleteAccount();
      onLogout();
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  function confirmLogout() {
    if (Platform.OS === 'web') {
      onLogout();
      return;
    }
    Alert.alert(t.profile.logoutTitle, t.profile.logoutBody, [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.profile.logout, style: 'destructive', onPress: onLogout },
    ]);
  }

  if (loading) return <Loading label={t.profile.loadingProfile} />;
  if (error && !account) return <ErrorState message={error} onRetry={load} />;

  const initials = (account?.name || account?.phone || '?').slice(0, 2).toUpperCase();
  const hasName = !!account?.name;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        {/* Avatar + edit */}
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Pressable onPress={startEditName} style={styles.editBadge}>
            <Text style={styles.editBadgeText}>✎</Text>
          </Pressable>
        </View>

        {/* Name + phone */}
        <Text style={styles.name}>{account?.name || t.profile.defaultCustomer}</Text>
        <Text style={styles.phone}>+91 {account?.phone}</Text>

        {/* Coin pill */}
        <Pressable onPress={() => void load()} style={styles.heroCoins}>
          <CoinChip balance={referral?.coinBalance ?? account?.coinBalance ?? 0} />
          <Text style={styles.coinRefreshHint}>{t.profile.tapRefresh}</Text>
        </Pressable>
      </View>

      {/* Display name */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{t.profile.yourName}</Text>
          {!editingName ? (
            <Pressable onPress={startEditName}>
              <Text style={styles.link}>{hasName ? t.profile.edit : t.profile.addName}</Text>
            </Pressable>
          ) : null}
        </View>
        {editingName ? (
          <View style={styles.nameEdit}>
            <TextInput
              style={styles.input}
              placeholder={t.profile.enterName}
              placeholderTextColor={theme.color.textFaint}
              value={nameDraft}
              onChangeText={setNameDraft}
              autoFocus
            />
            <Button label={t.common.save} onPress={saveName} busy={savingName} />
            <Button
              label={t.common.cancel}
              onPress={() => {
                setEditingName(false);
                setError(null);
              }}
              variant="ghost"
            />
          </View>
        ) : (
          <Text style={hasName ? styles.nameValue : styles.namePrompt}>
            {account?.name || t.profile.namePromptFull}
          </Text>
        )}
      </View>

      {/* Language */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.common.language}</Text>
        <View style={{ marginTop: theme.space.sm }}>
          <LanguagePicker />
        </View>
      </View>

      {/* Saved addresses */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{t.profile.savedAddresses}</Text>
          <Pressable
            onPress={() => {
              setAddingAddress((v) => !v);
              setEditingAddressId(null);
            }}
          >
            <Text style={styles.link}>{addingAddress ? t.common.cancel : t.profile.addNew}</Text>
          </Pressable>
        </View>

        {addresses.length === 0 && !addingAddress ? (
          <Text style={styles.namePrompt}>{t.profile.noAddresses}</Text>
        ) : null}

        {addresses.map((addr) => (
          <View key={addr.id} style={styles.addrCard}>
            {editingAddressId === addr.id ? (
              <AddressForm
                address={addr}
                onSaved={async () => {
                  setEditingAddressId(null);
                  await reloadAddresses();
                }}
                onError={setError}
                onCancel={() => setEditingAddressId(null)}
              />
            ) : (
              <View style={styles.addrCardInner}>
                <Text style={styles.addrIcon}>{profileAddrIcon(addr.label)}</Text>
                <View style={styles.flex}>
                  <Text style={styles.addrLabelText}>{addr.label}</Text>
                  <Text style={styles.addrLine}>{addr.line}</Text>
                  {addr.landmark ? <Text style={styles.addrLandmark}>{t.common.near} {addr.landmark}</Text> : null}
                </View>
                <View style={styles.addrActions}>
                  <Pressable
                    onPress={() => { setEditingAddressId(addr.id); setAddingAddress(false); }}
                    style={styles.addrActionBtn}
                    hitSlop={6}
                  >
                    <Text style={styles.addrEditIcon}>✎</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => removeAddress(addr.id)}
                    disabled={deletingAddressId === addr.id}
                    style={styles.addrActionBtn}
                    hitSlop={6}
                  >
                    <Text style={styles.addrDeleteIcon}>
                      {deletingAddressId === addr.id ? '…' : '🗑'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        ))}

        {addingAddress ? (
          <AddressForm
            onSaved={async () => {
              setAddingAddress(false);
              await reloadAddresses();
            }}
            onError={setError}
            onCancel={() => setAddingAddress(false)}
          />
        ) : null}
      </View>

      {/* Referrals & PassWaala Coins */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{t.profile.referEarn}</Text>
          <CoinChip balance={referral?.coinBalance ?? account?.coinBalance ?? 0} size="sm" onLight />
        </View>

        {referral?.referralCode ? (
          <>
            <Text style={styles.referralCaption}>{t.profile.shareCode}</Text>
            <View style={styles.referralCodeRow}>
              <View style={styles.referralCodeBox}>
                <Text style={styles.referralCodeText}>{referral.referralCode}</Text>
              </View>
              <Button
                label={copied ? t.profile.copied : t.profile.share}
                icon={copied ? '✓' : '🔗'}
                onPress={shareReferral}
                variant="secondary"
                size="sm"
                fullWidth={false}
              />
            </View>
          </>
        ) : (
          <Text style={styles.namePrompt}>{t.profile.codeSoon}</Text>
        )}

        {/* Apply a referral code */}
        <View style={styles.applyRow}>
          <TextInput
            style={[styles.input, styles.applyInput]}
            placeholder={t.profile.applyCode}
            placeholderTextColor={theme.color.textFaint}
            value={codeDraft}
            onChangeText={(t) => {
              setCodeDraft(t.toUpperCase());
              setReferralNotice(null);
            }}
            autoCapitalize="characters"
          />
          <Button label={t.profile.apply} onPress={applyCode} busy={applyingCode} size="sm" fullWidth={false} />
        </View>
        {referralNotice ? <Text style={styles.referralNotice}>{referralNotice}</Text> : null}

        {/* My referrals */}
        {referral && referral.referrals.length > 0 ? (
          <View style={styles.referralList}>
            <Text style={styles.referralListTitle}>{t.profile.yourReferrals}</Text>
            {referral.referrals.map((r) => (
              <View key={r.id} style={styles.referralItem}>
                <View style={styles.flex}>
                  <Text style={styles.referralItemType}>{formatReferralType(r.type)}</Text>
                  <Text style={styles.referralItemDate}>
                    {new Date(r.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                <View style={styles.referralItemRight}>
                  <Badge label={r.status} tone={referralTone(r.status)} />
                  {r.coinReward > 0 ? <CoinChip balance={r.coinReward} showUnit={false} size="sm" onLight /> : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Row label={t.profile.phone} value={`+91 ${account?.phone ?? ''}`} last />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        <Button label={t.profile.logout} onPress={confirmLogout} variant="outline" icon="↩" />
        <Button label={t.profile.deleteAccount} onPress={() => setConfirmDelete(true)} variant="danger" />
      </View>

      <Text style={styles.footer}>{t.profile.footer}</Text>

      <Modal visible={confirmDelete} transparent animationType="fade" onRequestClose={() => setConfirmDelete(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEmoji}>⚠️</Text>
            <Text style={styles.modalTitle}>{t.profile.deleteTitle}</Text>
            <Text style={styles.modalBody}>
              {t.profile.deleteBody}
            </Text>
            <Button label={t.profile.deleteConfirm} onPress={doDelete} variant="danger" busy={deleting} />
            <Button label={t.common.cancel} onPress={() => setConfirmDelete(false)} variant="ghost" />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

/** Map common address labels to icons; fallback to pin. */
function profileAddrIcon(label: string): string {
  const l = label.toLowerCase();
  if (l === 'home') return '🏠';
  if (l === 'work' || l === 'office') return '💼';
  return '📍';
}

function Row({
  label,
  value,
  valueNode,
  last,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      {valueNode ?? <Text style={styles.rowValue}>{value}</Text>}
    </View>
  );
}

/** Map a referral status to a Badge tone. */
function referralTone(status: string): 'success' | 'warning' | 'neutral' {
  const s = status.toUpperCase();
  if (s.includes('COMPLETE') || s.includes('REWARD') || s.includes('CREDIT')) return 'success';
  if (s.includes('PEND')) return 'warning';
  return 'neutral';
}

/** Humanize a referral type token (e.g. "SIGNUP_BONUS" → "Signup bonus"). */
function formatReferralType(type: string): string {
  const words = type.replace(/[_-]+/g, ' ').trim().toLowerCase();
  if (!words) return 'Referral';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  flex: { flex: 1 },
  scroll: { paddingBottom: theme.space.xxl },

  hero: {
    backgroundColor: theme.color.primary,
    alignItems: 'center',
    paddingTop: theme.space.xl,
    paddingBottom: theme.space.xxl,
    gap: theme.space.xs,
  },
  avatarWrap: { position: 'relative', marginBottom: theme.space.sm },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  avatarText: { fontSize: 32, fontWeight: theme.weight.heavy, color: theme.color.primary },
  editBadge: {
    position: 'absolute',
    bottom: 0,
    right: -4,
    width: 28,
    height: 28,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.color.primary,
  },
  editBadgeText: { fontSize: 14, color: theme.color.primary, fontWeight: theme.weight.bold },
  name: { fontSize: theme.font.h2, fontWeight: theme.weight.bold, color: theme.color.onPrimary },
  phone: { fontSize: theme.font.body, color: '#C8EDD9' },
  heroCoins: { marginTop: theme.space.md, alignSelf: 'center', alignItems: 'center' },
  coinRefreshHint: { fontSize: theme.font.tiny, color: 'rgba(255,255,255,0.5)', marginTop: 3 },

  section: {
    backgroundColor: theme.color.card,
    marginHorizontal: theme.space.lg,
    marginTop: theme.space.lg,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    ...shadow.sm,
  },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: theme.font.h3, fontWeight: theme.weight.bold, color: theme.color.text },
  link: { color: theme.color.primary, fontWeight: theme.weight.semibold, fontSize: theme.font.small },
  deleteLink: { color: theme.color.danger, fontWeight: theme.weight.semibold, fontSize: theme.font.small },

  nameEdit: { gap: theme.space.sm, marginTop: theme.space.sm },
  nameValue: { fontSize: theme.font.body, color: theme.color.text, fontWeight: theme.weight.semibold, marginTop: theme.space.xs },
  namePrompt: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space.xs },
  input: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    fontSize: theme.font.body,
    color: theme.color.text,
  },

  addrCard: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    marginTop: theme.space.sm,
  },
  addrCardInner: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
  addrIcon: { fontSize: 20, marginTop: 1 },
  addrLabelText: { fontSize: theme.font.small, fontWeight: theme.weight.bold, color: theme.color.text, marginBottom: 2 },
  addrHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addrActions: { flexDirection: 'row', gap: theme.space.sm, alignItems: 'center' },
  addrActionBtn: {
    width: 30,
    height: 30,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addrEditIcon: { fontSize: 15, color: theme.color.textMuted, fontWeight: theme.weight.bold },
  addrDeleteIcon: { fontSize: 14 },
  addrLine: { fontSize: theme.font.body, color: theme.color.text, fontWeight: theme.weight.medium },
  addrLandmark: { fontSize: theme.font.small, color: theme.color.textMuted },

  referralCaption: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space.xs },
  referralCodeRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, marginTop: theme.space.sm },
  referralCodeBox: {
    flex: 1,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.color.accent,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    backgroundColor: '#FFF7E0',
  },
  referralCodeText: {
    fontSize: theme.font.h3,
    fontWeight: theme.weight.heavy,
    color: theme.color.warning,
    letterSpacing: 2,
    textAlign: 'center',
  },
  applyRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, marginTop: theme.space.md },
  applyInput: { flex: 1 },
  referralNotice: { fontSize: theme.font.small, color: theme.color.primary, marginTop: theme.space.sm, fontWeight: theme.weight.medium },
  referralList: { marginTop: theme.space.md, gap: theme.space.xs },
  referralListTitle: { fontSize: theme.font.small, fontWeight: theme.weight.bold, color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  referralItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.space.sm,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    gap: theme.space.sm,
  },
  referralItemType: { fontSize: theme.font.body, color: theme.color.text, fontWeight: theme.weight.semibold },
  referralItemDate: { fontSize: theme.font.tiny, color: theme.color.textMuted },
  referralItemRight: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: theme.space.md },  rowBorder: { borderBottomWidth: 1, borderBottomColor: theme.color.border },
  rowLabel: { fontSize: theme.font.body, color: theme.color.textMuted },
  rowValue: { fontSize: theme.font.body, color: theme.color.text, fontWeight: theme.weight.semibold },

  error: { color: theme.color.danger, textAlign: 'center', marginTop: theme.space.md, paddingHorizontal: theme.space.lg },

  actions: { paddingHorizontal: theme.space.lg, marginTop: theme.space.lg, gap: theme.space.sm },
  footer: { textAlign: 'center', color: theme.color.textFaint, fontSize: theme.font.small, marginTop: theme.space.xl },

  modalBackdrop: { flex: 1, backgroundColor: theme.color.overlay, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },
  modalCard: {
    backgroundColor: theme.color.bg,
    borderRadius: theme.radius.lg,
    padding: theme.space.xl,
    gap: theme.space.sm,
    width: '100%',
    maxWidth: 360,
    alignItems: 'stretch',
  },
  modalEmoji: { fontSize: 40, textAlign: 'center' },
  modalTitle: { fontSize: theme.font.h2, fontWeight: theme.weight.bold, color: theme.color.text, textAlign: 'center' },
  modalBody: { fontSize: theme.font.body, color: theme.color.textMuted, textAlign: 'center', marginBottom: theme.space.sm },
});
