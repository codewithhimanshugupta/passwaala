import { useCallback, useEffect, useRef, useState } from 'react';
import { OrderStatus } from '@passwaala/shared';
import { api } from './api';
import { formatRupees } from './theme';
import { startAlert, stopAlert } from './sound';
import { canNotify, notifyNewOrder, requestNotifyPermission, vibrate } from './notify';
import type { FeedOrder } from './types';

/** How often the app polls the feed for freshly PLACED orders (ms). */
const POLL_MS = 4000;
/** Re-pulse the vibration on this cadence while an alert is unacknowledged (ms). */
const VIBRATE_MS = 3000;

export interface NewOrderAlerts {
  /** The fresh PLACED order currently ringing, or null when acknowledged. */
  alertOrder: FeedOrder | null;
  /** True if the sound couldn't start (no user gesture yet) — show a hint. */
  alertSilent: boolean;
  /** Stop the sound + clear the banner. */
  acknowledge: () => void;
  /** Whether browser notifications are granted (so the app can hide the prompt). */
  notifyGranted: boolean;
  /** Ask for notification permission (from a user gesture). */
  requestPermission: () => Promise<void>;
}

/**
 * App-wide new-order alerts. Lifted out of OrderFeedScreen so it fires on ANY
 * tab: polls the feed on an interval while `enabled`, and on a genuinely new
 * PLACED order rings the looping sound + vibrates + shows a banner (via the
 * returned `alertOrder`) + fires a backgrounded-tab OS notification. The first
 * poll only seeds the baseline so existing orders don't alarm. Web-first; all
 * browser APIs are guarded so native is a graceful no-op.
 */
export function useNewOrderAlerts(enabled: boolean, allShops = false): NewOrderAlerts {
  const [alertOrder, setAlertOrder] = useState<FeedOrder | null>(null);
  const [alertSilent, setAlertSilent] = useState(false);
  const [notifyGranted, setNotifyGranted] = useState<boolean>(() => canNotify());
  // Baseline of known PLACED order ids; null until the first poll seeds it.
  const knownPlacedRef = useRef<Set<string> | null>(null);

  const requestPermission = useCallback(async () => {
    const result = await requestNotifyPermission();
    setNotifyGranted(result === 'granted');
  }, []);

  const acknowledge = useCallback(() => {
    stopAlert();
    setAlertOrder(null);
    setAlertSilent(false);
  }, []);

  /**
   * Compare freshly-fetched PLACED orders against the previous set; on a new one
   * fire the alert. First call only seeds the baseline (no alarm on existing).
   */
  const detect = useCallback((feed: FeedOrder[]) => {
    const placed = feed.filter((o) => o.status === OrderStatus.PLACED);
    const placedIds = new Set(placed.map((o) => o.id));
    const prev = knownPlacedRef.current;
    knownPlacedRef.current = placedIds;
    if (prev === null) return; // first load — seed only
    const fresh = placed.find((o) => !prev.has(o.id));
    if (fresh) {
      setAlertOrder(fresh);
      setAlertSilent(!startAlert());
      vibrate();
      const total = fresh.adjustedTotalPaise ?? fresh.originalTotalPaise;
      notifyNewOrder('🔔 New order!', `#${fresh.id.slice(0, 8).toUpperCase()} · ${formatRupees(total)}`);
    }
  }, []);

  // Poll the feed on an interval while enabled, regardless of active tab. When
  // disabled (logged out / no shop) we reset the baseline so a later login
  // re-seeds instead of alarming on the whole existing queue.
  useEffect(() => {
    if (!enabled) {
      knownPlacedRef.current = null;
      stopAlert();
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const page = (await (allShops
          ? api.orderFeedAll('PLACED')
          : api.orderFeed('PLACED'))) as { items: FeedOrder[] };
        if (alive) detect(page.items);
      } catch {
        /* transient — the next tick retries */
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled, detect, allShops]);

  // Re-pulse the vibration while an alert is unacknowledged so it keeps being
  // felt (the sound loops on its own inside sound.ts).
  useEffect(() => {
    if (!alertOrder) return;
    const id = setInterval(() => vibrate(), VIBRATE_MS);
    return () => clearInterval(id);
  }, [alertOrder]);

  // Safety: stop any looping sound if the hook unmounts.
  useEffect(() => () => stopAlert(), []);

  return { alertOrder, alertSilent, acknowledge, notifyGranted, requestPermission };
}
