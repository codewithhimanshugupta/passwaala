import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from 'react-native';
import { DISPUTE_WINDOW_HOURS } from '@nearbaz/shared';
import { api } from '../api';
import { theme } from '../theme';

interface DisputeMessage {
  id: string;
  senderRole: string;
  body: string;
  createdAt: string;
}

interface Dispute {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  reopenCount: number;
  messages: DisputeMessage[];
}

// Rider-specific FAQ chips
const FAQ_CHIPS = [
  { label: 'Customer not home', text: 'I am at the delivery address but the customer is not home and not answering calls.' },
  { label: 'Wrong or unreachable address', text: 'The delivery address is incorrect or I cannot find the location.' },
  { label: 'COD cash issue', text: 'There is a dispute about the COD cash amount the customer paid me.' },
  { label: 'Shop not ready', text: 'I arrived at the shop for pickup but the order is not ready and the shop is unresponsive.' },
  { label: 'Safety or route issue', text: 'I am facing a safety concern or route blockage and cannot complete this delivery.' },
  { label: 'Unable to complete delivery', text: 'I am unable to complete this delivery. Please reassign or cancel.' },
];

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function isWithinWindow(orderCreatedAt: string): boolean {
  return Date.now() - new Date(orderCreatedAt).getTime() < DISPUTE_WINDOW_HOURS * 3600000;
}

export function DisputeModal({
  orderId,
  orderCreatedAt,
  senderRole,
  inline = false,
  orderSummary,
}: {
  orderId: string;
  orderCreatedAt: string;
  senderRole: string;
  inline?: boolean;
  orderSummary?: {
    shopName?: string | null;
    totalPaise?: number;
    itemCount?: number;
    deliveryFeePaise?: number;
    pickup?: string;
    drop?: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [dispute, setDispute] = useState<Dispute | null | undefined>(undefined);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const withinWindow = isWithinWindow(orderCreatedAt);

  // Don't render the trigger button at all when outside the dispute window
  // and there's no existing dispute to view.
  // (We still need to let them open an existing dispute thread even after window closes.)
  const loadDispute = useCallback(async () => {
    try {
      const d = (await api.myDispute(orderId)) as Dispute | null;
      setDispute(d ?? null);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
    } catch { setDispute(null); }
  }, [orderId]);

  useEffect(() => {
    if (!open) return;
    void loadDispute();
    const id = setInterval(() => void loadDispute(), 12000);
    return () => clearInterval(id);
  }, [open, loadDispute]);

  async function raise(text?: string) {
    const body = (text ?? reason).trim();
    if (!body) { setError('Please describe your issue.'); return; }
    setBusy(true); setError(null);
    try {
      await api.raiseDispute(orderId, body);
      await loadDispute();
      setReason('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function send() {
    if (!message.trim() || !dispute) return;
    const body = message.trim();
    setMessage('');
    try {
      await api.sendDisputeMessage(dispute.id, body);
      await loadDispute();
    } catch (e) { setError((e as Error).message); }
  }

  async function reopen() {
    if (!dispute) return;
    setReopening(true); setError(null);
    try {
      await api.reopenDispute(dispute.id);
      await loadDispute();
    } catch (e) { setError((e as Error).message); }
    finally { setReopening(false); }
  }

  const statusLabel = (s: string) =>
    s === 'RESOLVED' ? 'Resolved' : s === 'ASSIGNED' ? 'Admin joined' : 'Waiting for admin';

  // Only show the button if within window OR there's an existing dispute to continue
  // We check this lazily: always show button if within window; after window closes
  // the button only appears once opened (dispute state loaded) to avoid a fetch on render.
  if (!withinWindow) return null;

  return (
    <>
      {inline ? (
        <Pressable style={styles.helpBtn} onPress={() => setOpen(true)}>
          <Text style={styles.helpBtnText}>Need help with this order?</Text>
          <Text style={styles.helpArrow}>›</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.helpBtnStandalone} onPress={() => setOpen(true)}>
          <Text style={styles.helpBtnStandaloneText}>Need help with this order?</Text>
          <Text style={styles.helpArrow}>›</Text>
        </Pressable>
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.overlay}>
          <View style={styles.sheet}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <View>
                  <Text style={styles.headerTitle}>Help & Support</Text>
                  <Text style={styles.headerSub}>Order #{orderId.slice(0, 8).toUpperCase()}</Text>
                </View>
              </View>
              <Pressable onPress={() => setOpen(false)} hitSlop={12}>
                <Text style={styles.closeBtn}>✕</Text>
              </Pressable>
            </View>

            {/* Order summary strip */}
            {orderSummary && (
              <View style={styles.orderStrip}>
                {orderSummary.shopName ? <Text style={styles.orderStripShop}>{orderSummary.shopName}</Text> : null}
                <View style={styles.orderStripRow}>
                  {orderSummary.totalPaise != null ? <Text style={styles.orderStripMeta}>₹{(orderSummary.totalPaise / 100).toFixed(0)}</Text> : null}
                  {orderSummary.itemCount != null ? <Text style={styles.orderStripDot}>·</Text> : null}
                  {orderSummary.itemCount != null ? <Text style={styles.orderStripMeta}>{orderSummary.itemCount} item{orderSummary.itemCount !== 1 ? 's' : ''}</Text> : null}
                  {orderSummary.deliveryFeePaise != null ? <Text style={styles.orderStripDot}>·</Text> : null}
                  {orderSummary.deliveryFeePaise != null ? <Text style={styles.orderStripMeta}>Fee ₹{(orderSummary.deliveryFeePaise / 100).toFixed(0)}</Text> : null}
                </View>
                {orderSummary.pickup ? <Text style={styles.orderStripAddr} numberOfLines={1}>{orderSummary.pickup}</Text> : null}
                {orderSummary.drop ? <Text style={styles.orderStripAddr} numberOfLines={1}>{orderSummary.drop}</Text> : null}
              </View>
            )}

            {dispute === undefined ? (
              <View style={styles.center}><ActivityIndicator color={theme.color.primary} /></View>

            ) : dispute === null ? (
              // No dispute yet
              <ScrollView style={styles.preBody} contentContainerStyle={{ gap: 16 }}>
                {withinWindow ? (
                  <>
                    <View style={styles.introCard}>
                      <Text style={styles.introTitle}>What's the issue?</Text>
                      <Text style={styles.introSub}>Choose a common issue or describe it yourself. We'll respond quickly.</Text>
                    </View>

                    {/* FAQ chips */}
                    <View style={styles.chipsWrap}>
                      {FAQ_CHIPS.map(chip => (
                        <Pressable
                          key={chip.label}
                          style={[styles.chip, busy && styles.chipDisabled]}
                          onPress={() => { if (!busy) raise(chip.text); }}
                          disabled={busy}
                        >
                          <Text style={styles.chipText}>{chip.label}</Text>
                        </Pressable>
                      ))}
                    </View>

                    <View style={styles.dividerRow}>
                      <View style={styles.dividerLine} />
                      <Text style={styles.dividerText}>or describe</Text>
                      <View style={styles.dividerLine} />
                    </View>

                    <TextInput
                      style={styles.reasonInput}
                      placeholder="Type your issue here…"
                      placeholderTextColor={theme.color.textFaint}
                      multiline
                      value={reason}
                      onChangeText={(t) => { setReason(t); setError(null); }}
                      maxLength={500}
                    />
                    {error ? <Text style={styles.errText}>{error}</Text> : null}
                    <Pressable
                      style={[styles.raiseBtn, (!reason.trim() || busy) && styles.raiseBtnDisabled]}
                      onPress={() => raise()}
                      disabled={!reason.trim() || busy}
                    >
                      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.raiseBtnText}>Submit →</Text>}
                    </Pressable>
                  </>
                ) : (
                  <View style={styles.windowClosedCard}>
                    <Text style={styles.windowClosedTitle}>Dispute window closed</Text>
                    <Text style={styles.windowClosedSub}>Disputes can only be raised within {DISPUTE_WINDOW_HOURS} hours of placing an order.</Text>
                  </View>
                )}
              </ScrollView>

            ) : (
              // Chat thread
              <>
                {/* Status bar */}
                <View style={styles.statusBar}>
                  <Text style={styles.statusText}>{statusLabel(dispute.status)}</Text>
                  {dispute.status === 'OPEN' ? (
                    <Text style={styles.statusHint}>Usually responds within 5 min</Text>
                  ) : null}
                </View>

                <ScrollView
                  ref={scrollRef}
                  style={styles.messages}
                  onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
                >
                  {dispute.messages.map((msg) => {
                    const isSystem = msg.senderRole === 'SYSTEM';
                    const isAdmin = msg.senderRole === 'ADMIN';
                    const isMe = !isSystem && !isAdmin;
                    return (
                      <View key={msg.id} style={[
                        styles.msgRow,
                        isMe ? styles.msgRowMe : styles.msgRowOther,
                      ]}>
                        {!isMe ? (
                          <View style={[styles.avatar, isSystem ? styles.avatarSystem : styles.avatarAdmin]}>
                            <Text style={styles.avatarText}>{isSystem ? 'B' : 'A'}</Text>
                          </View>
                        ) : null}
                        <View style={[
                          styles.bubble,
                          isMe ? styles.bubbleMe : isSystem ? styles.bubbleSystem : styles.bubbleAdmin,
                        ]}>
                          {!isMe && (
                            <Text style={[styles.bubbleSender, isAdmin && styles.bubbleSenderAdmin]}>
                              {isSystem ? 'NearBaz Bot' : 'NearBaz Admin'}
                            </Text>
                          )}
                          <Text style={[styles.bubbleBody, isMe && styles.bubbleBodyMe]}>{msg.body}</Text>
                          <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>{fmtTime(msg.createdAt)}</Text>
                        </View>
                        {isMe ? <View style={styles.avatarSpacer} /> : null}
                      </View>
                    );
                  })}
                  {dispute.status !== 'RESOLVED' && dispute.messages.length > 0 && !dispute.messages.find(m => m.senderRole === 'ADMIN') ? (
                    <View style={styles.typingRow}>
                      <View style={[styles.avatar, styles.avatarAdmin]}>
                        <Text style={styles.avatarText}>A</Text>
                      </View>
                      <View style={styles.typingBubble}>
                        <Text style={styles.typingDots}>• • •</Text>
                      </View>
                    </View>
                  ) : null}
                </ScrollView>

                {dispute.status !== 'RESOLVED' ? (
                  <View style={styles.inputArea}>
                    <TextInput
                      style={styles.msgInput}
                      placeholder="Write a message…"
                      placeholderTextColor={theme.color.textFaint}
                      value={message}
                      onChangeText={setMessage}
                      maxLength={1000}
                      returnKeyType="send"
                      onSubmitEditing={send}
                      multiline
                    />
                    <Pressable
                      style={[styles.sendBtn, !message.trim() && styles.sendBtnDisabled]}
                      onPress={send}
                      disabled={!message.trim()}
                    >
                      <Text style={styles.sendBtnText}>↑</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.resolvedBar}>
                    <Text style={styles.resolvedText}>This dispute has been resolved. Thank you!</Text>
                    {(dispute.reopenCount ?? 0) < 1 ? (
                      <Pressable style={[styles.reopenBtn, reopening && { opacity: 0.5 }]} onPress={reopen} disabled={reopening}>
                        {reopening ? <ActivityIndicator color={theme.color.primary} size="small" /> : <Text style={styles.reopenBtnText}>Still not resolved? Reopen</Text>}
                      </Pressable>
                    ) : (
                      <Text style={styles.reopenUsed}>You've already reopened this once. Contact us directly.</Text>
                    )}
                  </View>
                )}
                {error ? <Text style={[styles.errText, { padding: 8 }]}>{error}</Text> : null}
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  helpBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: theme.space.md,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.md,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    minHeight: 44,
  },
  helpBtnText: { flex: 1, fontSize: theme.font.small, fontWeight: '700', color: '#92400E' },
  helpArrow: { fontSize: 18, color: '#D97706', fontWeight: '700' },
  helpBtnStandalone: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    marginTop: theme.space.sm,
    ...{ shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  },
  helpBtnStandaloneText: { flex: 1, fontSize: theme.font.body, fontWeight: '700', color: '#374151' },
  helpEmoji: { fontSize: 18 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    backgroundColor: '#FAFAFA',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '90%', minHeight: 400,
    width: '100%', maxWidth: 480,
  },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: theme.space.lg, borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  headerEmoji: { fontSize: 28 },
  headerTitle: { fontSize: theme.font.h3, fontWeight: '800', color: '#111827' },
  headerSub: { fontSize: theme.font.tiny, color: '#6B7280', marginTop: 1 },
  closeBtn: { fontSize: 18, color: '#9CA3AF', padding: 4 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  // Pre-raise screens
  preBody: { padding: theme.space.lg },
  introCard: {
    backgroundColor: '#EEF2FF', borderRadius: 16, padding: theme.space.lg, gap: 4,
  },
  introTitle: { fontSize: theme.font.h3, fontWeight: '800', color: '#3730A3' },
  introSub: { fontSize: theme.font.small, color: '#4338CA' },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  chip: {
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E5E7EB',
    borderRadius: theme.radius.pill, paddingVertical: 8, paddingHorizontal: 14,
  },
  chipDisabled: { opacity: 0.5 },
  chipText: { fontSize: theme.font.small, fontWeight: '600', color: '#374151' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  dividerText: { fontSize: theme.font.tiny, color: '#9CA3AF' },

  reasonInput: {
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E5E7EB',
    borderRadius: 14, padding: theme.space.md, minHeight: 80,
    fontSize: theme.font.body, color: '#111827', textAlignVertical: 'top',
  },
  errText: { fontSize: theme.font.small, color: '#DC2626' },
  raiseBtn: {
    backgroundColor: theme.color.primary, borderRadius: theme.radius.pill,
    paddingVertical: 14, alignItems: 'center',
  },
  raiseBtnDisabled: { opacity: 0.4 },
  raiseBtnText: { color: '#fff', fontWeight: '800', fontSize: theme.font.body },

  windowClosedCard: { alignItems: 'center', padding: 32, gap: 12 },
  windowClosedEmoji: { fontSize: 48 },
  windowClosedTitle: { fontSize: theme.font.h2, fontWeight: '800', color: '#374151' },
  windowClosedSub: { fontSize: theme.font.small, color: '#6B7280', textAlign: 'center', lineHeight: 20 },

  // Chat
  statusBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: theme.space.lg, paddingVertical: 8,
    backgroundColor: '#F9FAFB', borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  statusText: { fontSize: theme.font.small, fontWeight: '700', color: '#374151' },
  statusHint: { fontSize: theme.font.tiny, color: '#9CA3AF' },

  messages: { flex: 1, paddingHorizontal: theme.space.md, paddingTop: theme.space.md },

  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 12 },
  msgRowMe: { justifyContent: 'flex-end' },
  msgRowOther: { justifyContent: 'flex-start' },

  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarSystem: { backgroundColor: '#EEF2FF' },
  avatarAdmin: { backgroundColor: '#ECFDF5' },
  avatarText: { fontSize: 14 },
  avatarSpacer: { width: 28 },

  bubble: { maxWidth: '75%', borderRadius: 18, padding: 12, gap: 3 },
  bubbleMe: { backgroundColor: theme.color.primary, borderBottomRightRadius: 4 },
  bubbleSystem: { backgroundColor: '#EEF2FF', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#C7D2FE' },
  bubbleAdmin: { backgroundColor: '#ECFDF5', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#A7F3D0' },

  bubbleSender: { fontSize: theme.font.tiny, fontWeight: '800', color: '#6366F1' },
  bubbleSenderAdmin: { color: '#059669' },
  bubbleBody: { fontSize: theme.font.body, color: '#111827', lineHeight: 20 },
  bubbleBodyMe: { color: '#fff' },
  bubbleTime: { fontSize: 10, color: '#6B7280', alignSelf: 'flex-end' },
  bubbleTimeMe: { color: 'rgba(255,255,255,0.7)' },

  typingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 12 },
  typingBubble: { backgroundColor: '#F3F4F6', borderRadius: 18, borderBottomLeftRadius: 4, padding: 12 },
  typingDots: { fontSize: 20, color: '#9CA3AF', letterSpacing: 4 },

  inputArea: {
    flexDirection: 'row', gap: 8, padding: theme.space.md,
    borderTopWidth: 1, borderTopColor: '#F0F0F0',
    backgroundColor: '#fff', alignItems: 'flex-end',
  },
  msgInput: {
    flex: 1, backgroundColor: '#F9FAFB', borderWidth: 1.5, borderColor: '#E5E7EB',
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
    fontSize: theme.font.body, color: '#111827', maxHeight: 100,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#D1FAE5' },
  sendBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },

  resolvedBar: {
    margin: theme.space.lg, padding: 14, backgroundColor: '#ECFDF5',
    borderRadius: 12, gap: 8,
  },
  resolvedText: { fontSize: theme.font.small, color: '#065F46', fontWeight: '700', textAlign: 'center' },
  reopenBtn: {
    alignSelf: 'center', borderWidth: 1.5, borderColor: '#059669',
    borderRadius: theme.radius.pill, paddingVertical: 8, paddingHorizontal: 16,
  },
  reopenBtnText: { fontSize: theme.font.small, fontWeight: '700', color: '#059669' },
  reopenUsed: { fontSize: theme.font.tiny, color: '#6B7280', textAlign: 'center' },

  orderStrip: { backgroundColor: '#F0FDF4', borderBottomWidth: 1, borderBottomColor: '#BBF7D0', paddingHorizontal: theme.space.lg, paddingVertical: theme.space.sm, gap: 3 },
  orderStripShop: { fontSize: theme.font.small, fontWeight: '800', color: '#065F46' },
  orderStripRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  orderStripMeta: { fontSize: theme.font.small, color: '#047857', fontWeight: '600' },
  orderStripDot: { fontSize: theme.font.small, color: '#6EE7B7' },
  orderStripAddr: { fontSize: theme.font.tiny, color: '#059669' },
});
