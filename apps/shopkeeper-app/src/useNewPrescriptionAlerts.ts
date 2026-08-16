import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrescriptionView } from '@nearbaz/shared';
import { api } from './api';
import { startAlert, stopAlert } from './sound';
import { canNotify, notifyNewOrder, requestNotifyPermission, vibrate } from './notify';
import { onSocket } from './socket';

/** Fallback poll cadence — Rx arrive via socket; this is a safety net (ms). */
const POLL_MS = 60000;
/** Re-pulse the vibration on this cadence while an alert is unacknowledged (ms). */
const VIBRATE_MS = 3000;

export interface NewPrescriptionAlerts {
  /** The fresh SUBMITTED prescription currently ringing, or null when acknowledged. */
  alertRx: PrescriptionView | null;
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
 * App-wide new-prescription alerts — the exact mirror of useNewOrderAlerts but
 * for the medical-store Rx queue. Polls this shop's prescriptions on an interval
 * while `enabled`, and on a genuinely new SUBMITTED prescription rings the
 * looping sound + vibrates + shows a banner (via `alertRx`) + fires a
 * backgrounded-tab OS notification. The socket 'prescription.created' push is
 * the primary trigger; the poll is a fallback. The first poll only seeds the
 * baseline so existing prescriptions don't alarm. Web-first; all browser APIs
 * are guarded so native is a graceful no-op.
 */
export function useNewPrescriptionAlerts(enabled: boolean): NewPrescriptionAlerts {
  const [alertRx, setAlertRx] = useState<PrescriptionView | null>(null);
  const [alertSilent, setAlertSilent] = useState(false);
  const [notifyGranted, setNotifyGranted] = useState<boolean>(() => canNotify());
  // Baseline of known SUBMITTED prescription ids; null until the first poll seeds it.
  const knownSubmittedRef = useRef<Set<string> | null>(null);

  const requestPermission = useCallback(async () => {
    const result = await requestNotifyPermission();
    setNotifyGranted(result === 'granted');
  }, []);

  const acknowledge = useCallback(() => {
    stopAlert();
    setAlertRx(null);
    setAlertSilent(false);
  }, []);

  /**
   * Compare freshly-fetched SUBMITTED prescriptions against the previous set; on
   * a new one fire the alert. First call only seeds the baseline (no alarm on
   * existing prescriptions).
   */
  const detect = useCallback((list: PrescriptionView[]) => {
    const submitted = list.filter((p) => p.status === 'SUBMITTED');
    const submittedIds = new Set(submitted.map((p) => p.id));
    const prev = knownSubmittedRef.current;
    knownSubmittedRef.current = submittedIds;
    if (prev === null) return; // first load — seed only
    const fresh = submitted.find((p) => !prev.has(p.id));
    if (fresh) {
      setAlertRx(fresh);
      setAlertSilent(!startAlert());
      vibrate();
      const ref = (fresh.shortId || fresh.id.slice(0, 8)).toUpperCase();
      notifyNewOrder('New prescription!', `#${ref} · tap to build the bill`);
    }
  }, []);

  // Poll the queue on an interval while enabled, regardless of active tab. When
  // disabled (logged out / no shop) we reset the baseline so a later login
  // re-seeds instead of alarming on the whole existing queue.
  useEffect(() => {
    if (!enabled) {
      knownSubmittedRef.current = null;
      stopAlert();
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const list = await api.shopPrescriptions();
        if (alive) detect(list);
      } catch {
        /* transient (incl. 403 for non-medical shops) — the next tick retries */
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    // Realtime: prescription.created pushes trigger an immediate refresh (primary path).
    const off = onSocket('prescription.created', () => { void load(); });
    return () => {
      alive = false;
      clearInterval(id);
      off();
    };
  }, [enabled, detect]);

  // Re-pulse the vibration while an alert is unacknowledged.
  useEffect(() => {
    if (!alertRx) return;
    const id = setInterval(() => vibrate(), VIBRATE_MS);
    return () => clearInterval(id);
  }, [alertRx]);

  // Safety: stop any looping sound if the hook unmounts.
  useEffect(() => () => stopAlert(), []);

  return { alertRx, alertSilent, acknowledge, notifyGranted, requestPermission };
}
